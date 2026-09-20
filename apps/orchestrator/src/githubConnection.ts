/**
 * THE GITHUB CONNECTION: a token obtained with a button instead of a .env line.
 *
 * GitHub's device flow (shared/githubConnect.ts holds the pure half): ask for
 * a code, show it, poll until a person has approved it at
 * github.com/login/device. No callback URL and no secret, so it works on
 * localhost. Then the person ticks which of their repositories a scan may open
 * pull requests against; nothing else is ever offered to a scan.
 *
 *   - The token never leaves this process: status() carries names only.
 *   - It is kept in a file beside the orchestrator (.friction/github.json,
 *     git-ignored), so a restart does not mean reconnecting. That is a token in
 *     plaintext on this disk, the same exposure as GITHUB_TOKEN in .env.
 *   - With no connection, everything falls back to the environment exactly as
 *     before: GITHUB_TOKEN and the GITHUB_OWNER/REPO/ALLOWED_REPOS allow-list.
 *   - Nothing here throws into the process: the poll is a background job, and
 *     every way it can end is a status with a sentence.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { interpretDeviceToken, keepWritable, parseDeviceCode, writableRepos, type DeviceCode, type GitHubConnectionStatus } from "@friction/shared";
import { errorMessage, log, sleep } from "./util";

/** Repositories listed per connection: three pages of a hundred. */
const MAX_REPO_PAGES = 3;
const CALL_TIMEOUT_MS = 15_000;
const CALL_ATTEMPTS = 2;

export interface GitHubConnectionOptions {
  /** The OAuth App's public client id. Null: there is nothing to connect with, and the environment is all there is. */
  clientId: string | null;
  /** https://github.com, or a fake in tests. */
  oauthUrl: string;
  /** https://api.github.com, or GITHUB_API_URL. */
  apiUrl: string;
  /** Where the connection is kept between restarts. */
  file: string;
  /** The environment's token and allow-list: what is used while nothing is connected. */
  env: { token: string | null; allowed: readonly string[] };
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface Stored {
  token: string;
  login: string;
  /** Everything the token can write to, as of the last listing. */
  repos: string[];
  allowed: string[];
}

export class GitHubConnection {
  private stored: Stored | null = null;
  private pending: (DeviceCode & { expiresAt: number }) | null = null;
  private error: string | null = null;
  /** Bumped by every start() and disconnect(): an older poll sees it changed and stops. */
  private generation = 0;
  private readonly fetch: typeof fetch;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: GitHubConnectionOptions) {
    this.fetch = options.fetch ?? fetch;
    this.wait = options.wait ?? sleep;
    this.now = options.now ?? Date.now;
    this.load();
  }

  /** The token PRs are opened with: the connection's, else the environment's. Never sent anywhere but GitHub. */
  get token(): string | null {
    return this.stored?.token ?? this.options.env.token;
  }

  /** The repositories a scan may name. A connection's tick-list replaces the environment's allow-list; it never adds to it. */
  get allowed(): readonly string[] {
    return this.stored ? this.stored.allowed : this.options.env.allowed;
  }

  get source(): GitHubConnectionStatus["source"] {
    return this.stored ? "connection" : this.options.env.token ? "env" : "none";
  }

  get login(): string | null {
    return this.stored?.login ?? null;
  }

  status(): GitHubConnectionStatus {
    const base = { available: this.options.clientId !== null, source: this.source, allowed: [...this.allowed], ...(this.error ? { error: this.error } : {}) };
    if (this.stored) return { ...base, state: "connected", login: this.stored.login, repos: [...this.stored.repos] };
    if (this.pending) return { ...base, state: "pending", userCode: this.pending.userCode, verificationUri: this.pending.verificationUri, expiresAt: this.pending.expiresAt };
    return { ...base, state: "disconnected" };
  }

  /** Asks GitHub for a code and starts polling for its approval. Resolves as soon as there is a code to show. */
  async start(): Promise<GitHubConnectionStatus> {
    const { clientId } = this.options;
    if (!clientId) {
      this.error = "GITHUB_CLIENT_ID is not set, so there is nothing to connect with.";
      return this.status();
    }
    const generation = ++this.generation;
    this.error = null;
    this.pending = null;
    try {
      const code = parseDeviceCode(await this.call(`${this.options.oauthUrl}/login/device/code`, { method: "POST", form: { client_id: clientId, scope: "repo" } }));
      if (!code) throw new Error("GitHub did not answer with a device code: check GITHUB_CLIENT_ID, and that Device Flow is enabled for the OAuth App.");
      if (generation !== this.generation) return this.status();
      this.pending = { ...code, expiresAt: this.now() + code.expiresIn * 1000 };
      void this.poll(generation, clientId, code);
    } catch (err) {
      this.error = errorMessage(err);
      log("github", `could not start connecting: ${this.error}`);
    }
    return this.status();
  }

  /** The background half of start(). Every ending is recorded; none is thrown. */
  private async poll(generation: number, clientId: string, code: DeviceCode): Promise<void> {
    let interval = code.interval;
    const finish = (error: string | null): void => {
      if (generation !== this.generation) return;
      this.pending = null;
      this.error = error;
    };
    try {
      for (;;) {
        await this.wait(interval * 1000);
        if (generation !== this.generation) return;
        if (this.now() >= (this.pending?.expiresAt ?? 0)) return finish("The code expired before it was approved. Connect again for a new one.");
        let answer: ReturnType<typeof interpretDeviceToken>;
        try {
          const body = await this.call(`${this.options.oauthUrl}/login/oauth/access_token`, { method: "POST", form: { client_id: clientId, device_code: code.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" } });
          answer = interpretDeviceToken(body, interval);
        } catch (err) {
          // One unreachable poll is not the end: the code is still good until it expires.
          log("github", `poll failed, trying again: ${errorMessage(err)}`);
          continue;
        }
        if (answer.kind === "pending") continue;
        if (answer.kind === "slow_down") {
          interval = answer.interval;
          continue;
        }
        if (answer.kind === "denied") return finish("The request was declined on GitHub.");
        if (answer.kind === "expired") return finish("The code expired before it was approved. Connect again for a new one.");
        if (answer.kind === "error") return finish(`GitHub refused the connection: ${answer.message}`);
        if (generation !== this.generation) return;
        const { login, repos } = await this.describe(answer.token);
        if (generation !== this.generation) return;
        // Nothing is allowed until it is ticked: connecting alone opens no repository to a scan.
        this.stored = { token: answer.token, login, repos, allowed: [] };
        this.save();
        log("github", `connected as ${login}: ${repos.length} writable repositories, none allowed yet`);
        return finish(null);
      }
    } catch (err) {
      finish(`Connecting failed: ${errorMessage(err)}`);
      log("github", `connecting failed: ${errorMessage(err)}`);
    }
  }

  /**
   * Replaces the tick-list. The repositories are listed again first, so what
   * is kept is what the token can write to NOW, in GitHub's spelling; a slug
   * that was never offered is dropped, whoever sent it.
   */
  async setAllowed(slugs: readonly string[]): Promise<GitHubConnectionStatus> {
    if (!this.stored) {
      this.error = "Connect GitHub before choosing repositories.";
      return this.status();
    }
    try {
      const { repos } = await this.describe(this.stored.token);
      this.stored = { ...this.stored, repos, allowed: keepWritable(slugs, repos) };
      this.error = null;
      this.save();
      log("github", `allowed repositories: ${this.stored.allowed.join(", ") || "(none)"}`);
    } catch (err) {
      this.error = `The repositories could not be listed: ${errorMessage(err)}`;
    }
    return this.status();
  }

  /** Forgets the token, here and on disk. (Revoking it is done on GitHub: Settings -> Applications.) */
  disconnect(): GitHubConnectionStatus {
    this.generation += 1;
    this.stored = null;
    this.pending = null;
    this.error = null;
    try {
      rmSync(this.options.file, { force: true });
    } catch (err) {
      log("github", `could not remove ${this.options.file}: ${errorMessage(err)}`);
    }
    log("github", "disconnected");
    return this.status();
  }

  /** At startup: is the stored token still good? A revoked one is forgotten, with a sentence. Never throws. */
  async revalidate(): Promise<void> {
    const stored = this.stored;
    if (!stored) return;
    try {
      const { login, repos } = await this.describe(stored.token);
      if (this.stored?.token !== stored.token) return;
      this.stored = { ...stored, login, repos, allowed: keepWritable(stored.allowed, repos) };
      this.save();
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        this.disconnect();
        this.error = "GitHub no longer accepts the stored connection (it was revoked or expired). Connect again.";
      } else log("github", `could not check the stored connection: ${errorMessage(err)}`);
    }
  }

  /* ---------------------------------------------------------------- GitHub */

  private async describe(token: string): Promise<{ login: string; repos: string[] }> {
    const auth = { Authorization: `Bearer ${token}` };
    const user = (await this.call(`${this.options.apiUrl}/user`, { headers: auth })) as { login?: unknown };
    if (typeof user.login !== "string" || !user.login) throw new Error("GitHub did not say whose token this is.");
    const listed: unknown[] = [];
    for (let page = 1; page <= MAX_REPO_PAGES; page++) {
      const batch = await this.call(`${this.options.apiUrl}/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, { headers: auth });
      if (!Array.isArray(batch)) break;
      listed.push(...batch);
      if (batch.length < 100) break;
    }
    return { login: user.login, repos: writableRepos(listed) };
  }

  /** One JSON call: a timeout, and one more attempt on a network error or a 5xx. Errors carry the HTTP status, never a header or a body. */
  private async call(url: string, init: { method?: string; headers?: Record<string, string>; form?: Record<string, string> }): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.fetch(url, {
          method: init.method ?? "GET",
          headers: { Accept: "application/json", "User-Agent": "friction-fix-verification", ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...init.headers },
          body: init.form ? new URLSearchParams(init.form).toString() : undefined,
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        if (!response.ok) throw Object.assign(new Error(`GitHub answered ${response.status}`), { status: response.status });
        return await response.json();
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (attempt >= CALL_ATTEMPTS || (status !== undefined && status < 500)) throw err;
        await this.wait(500);
      }
    }
  }

  /* ------------------------------------------------------------------ disk */

  private load(): void {
    try {
      if (!existsSync(this.options.file)) return;
      const parsed = JSON.parse(readFileSync(this.options.file, "utf8")) as Partial<Stored>;
      if (typeof parsed.token !== "string" || !parsed.token || typeof parsed.login !== "string") return;
      const repos = Array.isArray(parsed.repos) ? parsed.repos.filter((r): r is string => typeof r === "string") : [];
      const allowed = Array.isArray(parsed.allowed) ? parsed.allowed.filter((r): r is string => typeof r === "string") : [];
      this.stored = { token: parsed.token, login: parsed.login, repos, allowed: keepWritable(allowed, repos) };
    } catch (err) {
      log("github", `ignoring ${this.options.file}: ${errorMessage(err)}`);
    }
  }

  private save(): void {
    if (!this.stored) return;
    try {
      mkdirSync(dirname(this.options.file), { recursive: true });
      writeFileSync(this.options.file, `${JSON.stringify(this.stored, null, 2)}\n`, { mode: 0o600 });
    } catch (err) {
      // The connection still works for this process; it just will not survive a restart.
      log("github", `could not save the connection to ${this.options.file}: ${errorMessage(err)}`);
    }
  }
}
