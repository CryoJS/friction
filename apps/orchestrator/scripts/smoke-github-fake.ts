/**
 * The scan pull request path against a FAKE GitHub: a local HTTP server that
 * speaks just enough of the REST API. No token, no network, nothing real is
 * written. It exists because no GitHub call in this repo has run against the
 * real API: this at least runs the real code (pr.ts, scanPullRequests.ts, the
 * Octokit client) end to end, including the failures a demo could meet.
 *
 *   pnpm --filter @friction/orchestrator smoke:github-fake
 *
 * What it cannot show: that api.github.com answers the way this fake does.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isCommittablePath, type FixRecord, type FixUpsert, type RunSnapshot, type TaskPullRequest } from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { config as loaded, type Config } from "../src/config";
import { openScanPullRequests } from "../src/scanPullRequests";
import type { WorkerClient } from "../src/workerClient";

const SLUG = "acme/shop";

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
function check(ok: unknown, message: string): void {
  if (!ok) fail(message);
  console.log(`  ok  ${message}`);
}

/* -------------------------------------------------------------- fake GitHub */

interface FakePull {
  number: number;
  head: string;
  base: string;
  draft: boolean;
  title: string;
  body: string;
}

class FakeGitHub {
  files = new Map<string, string>();
  branches = new Map<string, Map<string, string>>([["main", new Map()]]);
  pulls: FakePull[] = [];
  requests: string[] = [];
  /** One-shot failures, keyed by "METHOD path-prefix". */
  failures: Array<{ match: string; status: number; headers?: Record<string, string>; times: number }> = [];

  sha(content: string): string {
    let hash = 0;
    for (const char of content) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return `sha${(hash >>> 0).toString(16)}`;
  }

  get writes(): string[] {
    return this.requests.filter((request) => !request.startsWith("GET "));
  }

  handle(req: IncomingMessage, res: ServerResponse, body: string): void {
    const url = new URL(req.url ?? "/", "http://fake");
    const path = decodeURIComponent(url.pathname);
    const line = `${req.method} ${path}`;
    this.requests.push(line);
    const send = (status: number, json: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(json));
    };

    const failure = this.failures.find((f) => f.times > 0 && line.startsWith(f.match));
    if (failure) {
      failure.times -= 1;
      return send(failure.status, { message: `fake ${failure.status}` }, failure.headers);
    }

    const prefix = `/repos/${SLUG}`;
    if (!path.startsWith(prefix)) return send(404, { message: "Not Found" });
    const rest = path.slice(prefix.length);
    const html = (n: number): string => `https://github.example/${SLUG}/pull/${n}`;

    if (req.method === "GET" && rest === "") return send(200, { default_branch: "main", full_name: SLUG });
    if (req.method === "GET" && rest.startsWith("/git/ref/heads/")) {
      const name = rest.slice("/git/ref/heads/".length);
      return this.branches.has(name) ? send(200, { ref: `refs/heads/${name}`, object: { sha: "basesha", type: "commit" } }) : send(404, { message: "Not Found" });
    }
    if (req.method === "POST" && rest === "/git/refs") {
      const { ref } = JSON.parse(body) as { ref: string };
      const name = ref.replace("refs/heads/", "");
      if (this.branches.has(name)) return send(422, { message: "Reference already exists" });
      this.branches.set(name, new Map());
      return send(201, { ref, object: { sha: "basesha" } });
    }
    if (rest.startsWith("/contents/")) {
      const file = rest.slice("/contents/".length);
      if (req.method === "GET") {
        const content = this.files.get(file);
        if (content === undefined) return send(404, { message: "Not Found" });
        return send(200, { type: "file", path: file, sha: this.sha(content), size: content.length, encoding: "base64", content: Buffer.from(content).toString("base64") });
      }
      if (req.method === "PUT") {
        const put = JSON.parse(body) as { branch: string; sha: string; content: string };
        const branch = this.branches.get(put.branch);
        if (!branch) return send(404, { message: "Branch not found" });
        if (put.sha !== this.sha(this.files.get(file) ?? "")) return send(409, { message: "sha does not match" });
        branch.set(file, Buffer.from(put.content, "base64").toString("utf8"));
        return send(200, { content: { path: file }, commit: { sha: "c1" } });
      }
    }
    if (req.method === "POST" && rest === "/pulls") {
      const create = JSON.parse(body) as { head: string; base: string; draft?: boolean; title: string; body: string };
      const pull: FakePull = { number: this.pulls.length + 1, head: create.head, base: create.base, draft: create.draft === true, title: create.title, body: create.body };
      this.pulls.push(pull);
      return send(201, { number: pull.number, html_url: html(pull.number) });
    }
    if (req.method === "GET" && rest === "/pulls") {
      return send(200, [...this.pulls].reverse().map((pull) => ({ number: pull.number, html_url: html(pull.number), head: { ref: pull.head, repo: { full_name: SLUG } } })));
    }
    const files = /^\/pulls\/(\d+)\/files$/.exec(rest);
    if (req.method === "GET" && files) {
      const pull = this.pulls.find((candidate) => candidate.number === Number(files[1]));
      return send(200, [...(this.branches.get(pull?.head ?? "") ?? new Map()).keys()].map((filename) => ({ filename })));
    }
    return send(404, { message: `fake GitHub has no ${line}` });
  }
}

/* -------------------------------------------------------------- fake Worker */

function fix(findingId: string, stage: FixRecord["stage"], sourceFile: string | null, original: string | null, github: FakeGitHub): FixRecord {
  return {
    id: findingId,
    runId: "",
    findingId,
    stage,
    summary: `Fixes ${findingId}.`,
    patchJs: "try { void 0; } catch (e) {}",
    sourceFile,
    newFileContent: sourceFile ? `${original ?? ""}// fixed by ${findingId}\n` : null,
    sourceSha: original === null ? null : github.sha(original),
    before: { outcome: "timeout", steps: 13, durationMs: 60_000 },
    after: { outcome: "success", steps: 4, durationMs: 20_000 },
    prUrl: null,
    category: "dead_click",
    note: stage === "rejected" ? "dead_click still fires (2 times)." : undefined,
    createdAt: 1,
    updatedAt: 1,
  };
}

function fakeWorker(fixes: Record<string, FixRecord[]>) {
  const stored: TaskPullRequest[] = [];
  const posted: FixUpsert[] = [];
  const golden = getGoldenRun();
  const worker = {
    getFixes: async (runId: string): Promise<FixRecord[]> => fixes[runId] ?? [],
    getSnapshot: async (runId: string): Promise<RunSnapshot> => ({ ...golden, run: { ...golden.run, id: runId } }),
    upsertTaskPullRequest: async (pr: TaskPullRequest): Promise<boolean> => (stored.push(pr), true),
    postFix: async (_runId: string, upsert: FixUpsert) => (posted.push(upsert), null),
  } as unknown as WorkerClient;
  return { worker, stored, posted };
}

/* ---------------------------------------------------------------------- run */

const github = new FakeGitHub();
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
  req.on("end", () => github.handle(req, res, body));
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const config: Config = { ...loaded, mode: "live", githubToken: "fake-token", githubApiUrl: apiUrl, githubBaseBranch: null, allowedRepos: [SLUG], githubDryRun: false };
const tasks = [0, 1, 2, 3].map((taskIndex) => ({ taskIndex, runId: `r${taskIndex}`, title: `Task ${taskIndex + 1}` }));
const scan = (scanId: string, fixes: Record<string, FixRecord[]>, overrides: Partial<Config> = {}) => {
  const { worker, stored, posted } = fakeWorker(fixes);
  return openScanPullRequests({ config: { ...config, ...overrides }, worker, scanId, repo: SLUG, tasks, progress: async () => {} }).then((results) => ({ results, stored, posted }));
};

const CART = "export const cart = 1;\n".repeat(10);
const SEARCH = "export const search = 1;\n".repeat(10);
const MODAL = "export const modal = 1;\n".repeat(10);
github.files.set("src/Cart.tsx", CART).set("src/Search.tsx", SEARCH).set("src/Modal.tsx", `${MODAL}// edited since\n`).set(".github/workflows/ci.yml", "on: push\n");

const fixesOf = (): Record<string, FixRecord[]> => ({
  r0: [fix("f3", "verified", "src/Cart.tsx", CART, github), fix("f9", "rejected", null, null, github)],
  r1: [fix("f4", "verified", "src/Cart.tsx", CART, github), fix("f5", "verified", "src/Search.tsx", SEARCH, github)],
  // The file changed on main since the fix was generated, and a path the guard refuses.
  r2: [fix("f6", "verified", "src/Modal.tsx", MODAL, github), fix("f7", "verified", ".github/workflows/ci.yml", "on: push\n", github)],
  r3: [],
});

console.log("1. a scan with four tasks");
const first = await scan("s_scanone111", fixesOf());
check(first.results.map((r) => r.status).join() === "opened,opened,skipped,nothing_to_fix", `statuses: ${first.results.map((r) => r.status).join()}`);
check(github.pulls.length === 2 && github.pulls.every((pull) => pull.draft && pull.base === "main"), "two pull requests, both drafts against main");
check(github.pulls[0]?.head === "friction/scan-scanone1-task-1" && github.pulls[1]?.head === "friction/scan-scanone1-task-2", "branches are friction/scan-<id>-task-<n>");
check([...(github.branches.get("friction/scan-scanone1-task-2") ?? new Map()).keys()].join() === "src/Search.tsx", "task 2 commits only Search.tsx: Cart.tsx belongs to task 1's PR");
check(first.results[1]?.notFixed.some((item) => item.findingId === "f4" && item.coveredBy === 0), "task 2's Cart.tsx fix is recorded as covered by task 1");
check(github.pulls[0]?.body.includes("## Also unblocks") && github.pulls[0]?.body.includes("Task 2"), "task 1's PR lists task 2 under Also unblocks");
check(github.pulls[0]?.body.includes("## Found, not fixed") && github.pulls[0]?.body.includes("dead_click still fires"), "task 1's PR lists its rejected fix under Found, not fixed");
check(first.results[2]?.notFixed.some((item) => item.reason.includes("has changed on main")), "a file that changed since generation is skipped, not overwritten");
check(first.results[2]?.notFixed.some((item) => item.reason.includes(".github/ is off limits")), "the workflow file is refused by the path guard");
check(first.posted.filter((p) => p.stage === "pr_opened").map((p) => p.findingId).join() === "f3,f5", "committed fixes move to pr_opened with the PR's URL");
check([...github.branches.values()].every((branch) => [...branch.keys()].every(isCommittablePath)), "nothing outside the path guard was committed");
check(github.branches.get("main")?.size === 0, "nothing was committed to main");
check(github.writes.every((w) => /^(POST \/repos\/acme\/shop\/(git\/refs|pulls)|PUT \/repos\/acme\/shop\/contents\/)/.test(w)), "the only writes are createRef, createOrUpdateFileContents and pulls.create");

console.log("2. the same scan again: no duplicates");
const writesBefore = github.writes.length;
const second = await scan("s_scantwo222", fixesOf());
check(second.results.map((r) => r.status).join() === "covered,covered,skipped,nothing_to_fix", `statuses: ${second.results.map((r) => r.status).join()}`);
check(second.results[0]?.coveredBy === "https://github.example/acme/shop/pull/1", "task 1 is covered by the open PR's URL");
check(github.writes.length === writesBefore && github.pulls.length === 2, "a re-scan wrote nothing");

console.log("3. failures stay with their task");
github.pulls = [];
github.branches = new Map([["main", new Map()], ["friction/scan-scanthr3-task-1", new Map()]]);
github.failures.push({ match: "POST /repos/acme/shop/pulls", status: 429, headers: { "retry-after": "1" }, times: 1 });
const third = await scan("s_scanthr333", { r0: [fix("f3", "verified", "src/Cart.tsx", CART, github)], r1: [fix("f5", "verified", "src/Search.tsx", SEARCH, github)] });
check(third.results[0]?.status === "opened" && third.results[0]?.branch === "friction/scan-scanthr3-task-1-r0", "a taken branch name falls through to a suffixed one; the existing branch is untouched");
check(github.branches.get("friction/scan-scanthr3-task-1")?.size === 0, "the existing branch got no commit");
check(github.requests.filter((r) => r === "POST /repos/acme/shop/pulls").length >= 3, "a 429 with retry-after was retried");

github.pulls = [];
github.branches = new Map([["main", new Map()]]);
github.failures.push({ match: "POST /repos/acme/shop/git/refs", status: 403, times: 1 });
const fourth = await scan("s_scanfou444", { r0: [fix("f3", "verified", "src/Cart.tsx", CART, github)], r1: [fix("f4", "verified", "src/Cart.tsx", CART, github)] });
check(fourth.results[0]?.status === "failed" && /403/.test(fourth.results[0]?.reason ?? ""), `a 403 is a failed status with a sentence: ${fourth.results[0]?.reason}`);
check(fourth.results[1]?.status === "opened", "the next task is not covered by a PR that never opened: it opens its own");

github.failures.push({ match: "GET /repos/acme/shop", status: 404, times: 99 });
const fifth = await scan("s_scanfiv555", { r0: [fix("f3", "verified", "src/Cart.tsx", CART, github)] });
check(fifth.results[0]?.status === "failed" && /not found/.test(fifth.results[0]?.reason ?? ""), `an unreachable repository fails each fixable task with a sentence: ${fifth.results[0]?.reason}`);
check(fifth.results[3]?.status === "nothing_to_fix", "and tasks with nothing to fix are unaffected");
github.failures = [];

console.log("4. GITHUB_DRY_RUN: reads, no writes");
github.pulls = [];
github.branches = new Map([["main", new Map()]]);
const before = github.writes.length;
const dry = await scan("s_scandry666", fixesOf(), { githubDryRun: true });
check(dry.results.map((r) => r.status).join() === "dry_run,dry_run,skipped,nothing_to_fix", `statuses: ${dry.results.map((r) => r.status).join()}`);
check(dry.results[0]?.preview?.files[0]?.path === "src/Cart.tsx" && dry.results[0]?.preview?.files[0]?.addedLines === 1, "the preview counts the changed lines against the real file");
check(github.writes.length === before && dry.posted.length === 0, "a dry run wrote nothing, and moved no fix to pr_opened");

server.close();
console.log("OK  (a fake GitHub; the real API has still never been called)");
process.exit(0);
