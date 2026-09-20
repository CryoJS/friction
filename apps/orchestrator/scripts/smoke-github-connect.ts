/**
 * Connecting GitHub with the button, end to end, against a FAKE GitHub. No
 * keys, no network, and it never touches a real connection: the orchestrator
 * it starts keeps its token in a temporary file.
 *
 *   pnpm --filter @friction/orchestrator smoke:github-connect
 *
 * The REAL orchestrator process (its routes, its guard, config's live fields)
 * is started on a spare port, pointed at a local server that speaks GitHub's
 * two device-flow endpoints and the two REST calls a connection makes.
 *
 * What it cannot show: that github.com answers the way this fake does. The
 * answers are modelled on GitHub's device flow documentation.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GitHubConnectionStatus, OrchestratorHealth } from "@friction/shared";

const TOKEN = "gho_SMOKEsmokeSMOKEsmokeSMOKE";
const DEVICE_CODE = "smoke-device-code-1234567890";
const PORT = 8796;
const ORCHESTRATOR = `http://127.0.0.1:${PORT}`;
const LOCAL = { Origin: "http://localhost:5173", "Content-Type": "application/json" };

let failures = 0;
function check(name: string, ok: unknown, detail?: unknown): void {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
}
const sleep = (ms: number): Promise<void> => new Promise((resume) => setTimeout(resume, ms));

/* -------------------------------------------------------------- fake GitHub */

let approved = false;
let polls = 0;
const seen: string[] = [];
const github = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += String(chunk)));
  req.on("end", () => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    seen.push(`${req.method} ${path}`);
    const send = (status: number, json: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (req.method === "POST" && path === "/login/device/code") {
      if (!body.includes("client_id=Iv1.smoke") || !body.includes("scope=repo")) return send(200, { error: "incorrect_client_credentials" });
      return send(200, { device_code: DEVICE_CODE, user_code: "SMOK-TEST", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 });
    }
    if (req.method === "POST" && path === "/login/oauth/access_token") {
      polls += 1;
      if (!body.includes(`device_code=${DEVICE_CODE}`)) return send(200, { error: "incorrect_device_code" });
      return send(200, approved ? { access_token: TOKEN, token_type: "bearer", scope: "repo" } : { error: "authorization_pending" });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: "Bad credentials" });
    if (path === "/user") return send(200, { login: "smoke-user" });
    if (path === "/user/repos")
      return send(200, [
        { full_name: "smoke-user/shop", permissions: { push: true } },
        { full_name: "smoke-user/blog", permissions: { push: true } },
        { full_name: "big-org/read-only", permissions: { push: false } },
      ]);
    return send(404, { message: "Not Found" });
  });
});
await new Promise<void>((ready) => github.listen(0, "127.0.0.1", ready));
const fake = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;

/* ------------------------------------------------------- real orchestrator */

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "friction-connect-"));
const file = join(dir, "github.json");
let output = "";
let child: ChildProcess | null = null;

function startOrchestrator(): ChildProcess {
  const started = spawn(process.execPath, [resolve(appDir, "node_modules/tsx/dist/cli.mjs"), "src/index.ts"], {
    cwd: appDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      // Live mode without a single real key: nothing here ever runs an agent. Empty GITHUB_* so a real .env's values are not picked up.
      FRICTION_MOCK: "",
      OPENAI_API_KEY: "smoke",
      OPENAI_MODEL: "smoke",
      BROWSER_ENV: "LOCAL",
      GITHUB_TOKEN: "",
      GITHUB_OWNER: "",
      GITHUB_REPO: "",
      GITHUB_ALLOWED_REPOS: "",
      GITHUB_DRY_RUN: "",
      GITHUB_CLIENT_ID: "Iv1.smoke",
      GITHUB_OAUTH_URL: fake,
      GITHUB_API_URL: fake,
      GITHUB_CONNECTION_FILE: file,
    },
  });
  started.stdout?.on("data", (chunk) => (output += String(chunk)));
  started.stderr?.on("data", (chunk) => (output += String(chunk)));
  return started;
}

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T; text: string }> {
  const response = await fetch(`${ORCHESTRATOR}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as T, text };
}
const post = (path: string, body: unknown, headers: Record<string, string> = LOCAL) => call<GitHubConnectionStatus & { error?: string }>(path, { method: "POST", headers, body: JSON.stringify(body) });

async function up(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${ORCHESTRATOR}/health`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`the orchestrator did not come up:\n${output.slice(-1500)}`);
}

async function stop(): Promise<void> {
  const running = child;
  child = null;
  if (!running || running.exitCode !== null) return;
  await new Promise<void>((done) => {
    running.once("exit", () => done());
    running.kill();
    setTimeout(done, 5000);
  });
}

try {
  child = startOrchestrator();
  await up();

  console.log("1. Nothing connected");
  const before = await call<OrchestratorHealth>("/health");
  check("/health offers no repository, only previews, and says nothing is connected", before.body.repos?.length === 0 && before.body.githubDryRun === true && before.body.github?.source === "none", before.body);
  const idle = await call<GitHubConnectionStatus>("/github");
  check("the button is available, and the connection is disconnected", idle.body.available && idle.body.state === "disconnected", idle.body);

  console.log("2. Only this machine's control room may manage the connection");
  const foreign = await post("/github/connect", {}, { Origin: "https://evil.pages.dev", "Content-Type": "application/json" });
  check("a page that is not local is refused (403), although CORS admits *.pages.dev for reads", foreign.status === 403, foreign);
  const foreignTick = await post("/github/allowed", { repos: ["smoke-user/shop"] }, { Origin: "https://friction.pages.dev", "Content-Type": "application/json" });
  check("and cannot tick a repository", foreignTick.status === 403, foreignTick);
  check("GitHub was never contacted for it", seen.length === 0, seen);

  console.log("3. Connect: a code to type, then GitHub's approval");
  const pending = await post("/github/connect", {});
  check("a code and github.com's page come back", pending.body.state === "pending" && pending.body.userCode === "SMOK-TEST" && pending.body.verificationUri === "https://github.com/login/device", pending.body);
  await sleep(2500);
  check("it keeps waiting while nobody has approved", (await call<GitHubConnectionStatus>("/github")).body.state === "pending" && polls >= 1, { polls });
  approved = true;
  let connected = (await call<GitHubConnectionStatus>("/github")).body;
  for (let i = 0; i < 20 && connected.state !== "connected"; i++) {
    await sleep(500);
    connected = (await call<GitHubConnectionStatus>("/github")).body;
  }
  check("approved on GitHub: connected, as the account GitHub names", connected.state === "connected" && connected.login === "smoke-user", connected);
  check("it lists what the token can push to, and not the read-only repository", connected.repos?.join() === "smoke-user/blog,smoke-user/shop", connected.repos);
  check("connecting alone allows nothing", connected.allowed.length === 0, connected.allowed);

  console.log("4. Tick a repository");
  const ticked = await post("/github/allowed", { repos: ["SMOKE-USER/Shop", "big-org/read-only", "torvalds/linux"] });
  check("only a writable repository is kept, in GitHub's spelling", ticked.body.allowed.join() === "smoke-user/shop", ticked.body.allowed);
  const after = await call<OrchestratorHealth>("/health");
  check("/health now offers it, with no restart, and says whose connection it is", after.body.repos?.join() === "smoke-user/shop" && after.body.github?.source === "connection" && after.body.github.login === "smoke-user", after.body);
  check("a token exists now, so pull requests are no longer preview-only", after.body.githubDryRun === false, after.body);
  const refused = await call<{ error?: string }>("/scans", { method: "POST", headers: LOCAL, body: JSON.stringify({ url: "https://shop.example/", repo: "smoke-user/blog", autoPr: true }) });
  check("a scan naming a repository that is not ticked is refused (400), though the token could write to it", refused.status === 400 && /not one of this orchestrator's allowed repositories/.test(refused.body.error ?? ""), refused);
  const junk = await post("/github/allowed", { repos: "smoke-user/shop" });
  check("a malformed tick-list is refused (400)", junk.status === 400, junk);

  console.log("5. The token stays in the orchestrator");
  const everything = [before, idle, pending, ticked, after].map((answer) => answer.text).join("\n") + JSON.stringify(connected) + output;
  check("no response and no log line holds the token or the device code", !everything.includes(TOKEN) && !everything.includes(DEVICE_CODE));
  check("it is in the connection file, and nowhere else on disk that was asked for", existsSync(file) && readFileSync(file, "utf8").includes(TOKEN));

  console.log("6. It survives a restart, and Disconnect forgets it");
  await stop();
  child = startOrchestrator();
  await up();
  const restarted = await call<OrchestratorHealth>("/health");
  check("after a restart: still connected, same repository allowed, nothing typed again", restarted.body.repos?.join() === "smoke-user/shop" && restarted.body.github?.login === "smoke-user", restarted.body);
  const gone = await post("/github/disconnect", {});
  check("Disconnect: disconnected, nothing allowed", gone.body.state === "disconnected" && gone.body.allowed.length === 0, gone.body);
  check("and the file is gone", !existsSync(file));
  const final = await call<OrchestratorHealth>("/health");
  check("/health is back to offering nothing", final.body.repos?.length === 0 && final.body.github?.source === "none" && final.body.githubDryRun === true, final.body);
} catch (err) {
  check("the smoke ran to the end", false, err instanceof Error ? err.message : String(err));
} finally {
  await stop();
  github.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "OK  (a fake GitHub; the real device flow has still never been run)" : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
