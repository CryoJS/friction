import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { GitHubConnection } from "./githubConnection";

const TOKEN = "gho_SECRETsecretSECRETsecret";
const CODE = { device_code: "devcode123", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 };
const REPOS = [
  { full_name: "Kevin-Kolyakov/northpeak-store-test", permissions: { push: true } },
  { full_name: "CryoJS/friction", permissions: { push: true } },
  { full_name: "someone/read-only", permissions: { push: false } },
];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A GitHub that answers the token poll from a script, and records everything it was asked. */
function harness(polls: unknown[], options: { user?: () => Response; file?: string; env?: { token: string | null; allowed: string[] } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "friction-gh-"));
  dirs.push(dir);
  const file = options.file ?? join(dir, ".friction", "github.json");
  const requests: Array<{ url: string; body: string; auth: string | null }> = [];
  const waits: number[] = [];
  let clock = 1_000_000;
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? ""), auth: new Headers(init?.headers).get("Authorization") });
    if (url.endsWith("/login/device/code")) return json(CODE);
    if (url.endsWith("/login/oauth/access_token")) {
      const next = polls.shift();
      if (next instanceof Error) throw next;
      return json(next ?? { error: "authorization_pending" });
    }
    if (url.endsWith("/user")) return options.user ? options.user() : json({ login: "Kevin-Kolyakov" });
    if (url.includes("/user/repos")) return json(REPOS);
    return json({ message: "Not Found" }, 404);
  }) as typeof fetch;
  const connection = new GitHubConnection({
    clientId: "Iv1.client",
    oauthUrl: "https://github.test",
    apiUrl: "https://api.github.test",
    file,
    env: options.env ?? { token: null, allowed: [] },
    fetch: fakeFetch,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  /** The poll runs in the background: let it play out. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 50; i++) await new Promise((resume) => setImmediate(resume));
  };
  return { connection, requests, waits, file, settle };
}

describe("GitHubConnection", () => {
  it("shows a code, waits out pending and slow_down, and connects with nothing allowed yet", async () => {
    const { connection, requests, waits, settle } = harness([{ error: "authorization_pending" }, { error: "slow_down", interval: 10 }, { access_token: TOKEN }]);
    const pending = await connection.start();
    assert.deepEqual([pending.state, pending.userCode, pending.verificationUri], ["pending", "WDJB-MJHT", "https://github.com/login/device"]);
    assert.match(requests[0]?.body ?? "", /client_id=Iv1\.client&scope=repo/);
    await settle();

    const status = connection.status();
    assert.deepEqual([status.state, status.login, status.source], ["connected", "Kevin-Kolyakov", "connection"]);
    assert.deepEqual(status.repos, ["CryoJS/friction", "Kevin-Kolyakov/northpeak-store-test"]);
    assert.deepEqual(status.allowed, [], "connecting alone must open no repository to a scan");
    assert.deepEqual(waits.slice(0, 3), [5000, 5000, 10_000], "slow_down must lengthen the interval");
    assert.equal(connection.token, TOKEN);
  });

  it("never lets the token, or the device code that would fetch one, into a status", async () => {
    const { connection, settle } = harness([{ access_token: TOKEN }]);
    const pending = JSON.stringify(await connection.start());
    await settle();
    const connected = JSON.stringify(connection.status());
    for (const text of [pending, connected]) {
      assert.ok(!text.includes(TOKEN) && !text.includes("devcode123"), text);
    }
  });

  it("only a repository the token can write to can be ticked, in GitHub's spelling", async () => {
    const { connection, settle } = harness([{ access_token: TOKEN }]);
    await connection.start();
    await settle();
    const status = await connection.setAllowed(["kevin-kolyakov/NORTHPEAK-store-test", "someone/read-only", "torvalds/linux", "../.."]);
    assert.deepEqual(status.allowed, ["Kevin-Kolyakov/northpeak-store-test"]);
    assert.deepEqual([...connection.allowed], ["Kevin-Kolyakov/northpeak-store-test"]);
  });

  it("a declined, expired or refused request ends disconnected, with a sentence", async () => {
    for (const [answer, expected] of [
      [{ error: "access_denied" }, /declined on GitHub/],
      [{ error: "expired_token" }, /expired before it was approved/],
      [{ error: "device_flow_disabled", error_description: "Device Flow must be explicitly enabled for this App" }, /Device Flow must be explicitly enabled/],
    ] as const) {
      const { connection, settle } = harness([answer]);
      await connection.start();
      await settle();
      const status = connection.status();
      assert.equal(status.state, "disconnected");
      assert.match(status.error ?? "", expected);
      assert.equal(connection.token, null);
    }
  });

  it("a poll that cannot reach GitHub is tried again, and nothing is ever thrown into the process", async () => {
    const { connection, settle } = harness([new Error("fetch failed"), new Error("fetch failed"), new Error("fetch failed"), new Error("fetch failed"), { access_token: TOKEN }]);
    await connection.start();
    await settle();
    assert.equal(connection.status().state, "connected");

    const broken = harness([{ access_token: TOKEN }], { user: () => new Response("{}", { status: 401 }) });
    await broken.connection.start();
    await broken.settle();
    assert.equal(broken.connection.status().state, "disconnected");
    assert.match(broken.connection.status().error ?? "", /Connecting failed: GitHub answered 401/);
  });

  it("the code stops being polled once it has expired", async () => {
    const { connection, requests, settle } = harness(Array.from({ length: 400 }, () => ({ error: "authorization_pending" })));
    await connection.start();
    await settle();
    await settle();
    await settle();
    await settle();
    assert.equal(connection.status().state, "disconnected");
    assert.match(connection.status().error ?? "", /expired/);
    assert.ok(requests.filter((r) => r.url.endsWith("/access_token")).length <= 180, "polled no longer than the code lives (900s at 5s)");
  });

  it("survives a restart, and disconnecting forgets it here and on disk", async () => {
    const first = harness([{ access_token: TOKEN }]);
    await first.connection.start();
    await first.settle();
    await first.connection.setAllowed(["CryoJS/friction"]);
    assert.ok(existsSync(first.file));
    assert.ok(readFileSync(first.file, "utf8").includes(TOKEN), "the file is where the token lives between runs");

    const restarted = harness([], { file: first.file });
    assert.deepEqual([restarted.connection.status().state, restarted.connection.token, [...restarted.connection.allowed]], ["connected", TOKEN, ["CryoJS/friction"]]);

    assert.equal(restarted.connection.disconnect().state, "disconnected");
    assert.equal(existsSync(first.file), false);
    assert.equal(restarted.connection.token, null);
  });

  it("a stored connection GitHub no longer accepts is forgotten at startup, with a sentence", async () => {
    const first = harness([{ access_token: TOKEN }]);
    await first.connection.start();
    await first.settle();
    const revoked = harness([], { file: first.file, user: () => new Response("{}", { status: 401 }) });
    await revoked.connection.revalidate();
    assert.equal(revoked.connection.status().state, "disconnected");
    assert.match(revoked.connection.status().error ?? "", /revoked or expired/);
    assert.equal(existsSync(first.file), false);
  });

  it("with nothing connected, the environment's token and allow-list are used exactly as before", async () => {
    const { connection, settle } = harness([{ access_token: TOKEN }], { env: { token: "ghp_env", allowed: ["Kevin-Kolyakov/northpeak-store-test"] } });
    assert.deepEqual([connection.source, connection.token, [...connection.allowed]], ["env", "ghp_env", ["Kevin-Kolyakov/northpeak-store-test"]]);
    await connection.start();
    await settle();
    // Connected: the tick-list REPLACES the environment's allow-list; it never adds to it.
    assert.deepEqual([connection.source, connection.token, [...connection.allowed]], ["connection", TOKEN, []]);
    connection.disconnect();
    assert.deepEqual([connection.source, connection.token], ["env", "ghp_env"]);
  });

  it("with no client id there is nothing to connect with, and it says so", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friction-gh-"));
    dirs.push(dir);
    const connection = new GitHubConnection({ clientId: null, oauthUrl: "https://github.test", apiUrl: "https://api.github.test", file: join(dir, "github.json"), env: { token: null, allowed: [] } });
    const status = await connection.start();
    assert.deepEqual([status.available, status.state], [false, "disconnected"]);
    assert.match(status.error ?? "", /GITHUB_CLIENT_ID/);
  });
});
