/**
 * End-to-end check of a scan, in mock mode: no keys, no browser.
 *
 *   pnpm dev:worker
 *   FRICTION_MOCK=1 pnpm dev:orchestrator
 *   pnpm --filter @friction/orchestrator smoke:scan [url]
 *
 * Starts a scan, follows the tree until it finishes, then checks the merged
 * report. Exits 1 on the first thing that is wrong.
 *
 * With SMOKE_PR=1 the scan is started with the first repository /health
 * offers and automatic pull requests, and every task's pull request status is
 * printed and checked. Mock mode only previews, so this pushes nothing; it
 * refuses to run against an orchestrator that would.
 */
import {
  isCommittablePath,
  isScanFinished,
  isTerminalState,
  type CreateScanResponse,
  type OrchestratorHealth,
  type ScanReportResponse,
  type ScanTreeResponse,
} from "@friction/shared";

const ORCHESTRATOR = (process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
const WORKER = (process.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const TARGET = process.argv[2] ?? `${WORKER}/demo-shop/`;
const DEADLINE_MS = 5 * 60_000;
const WITH_PRS = ["1", "true", "yes"].includes((process.env.SMOKE_PR ?? "").toLowerCase());

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function follow(scanId: string): Promise<ScanTreeResponse> {
  const started = Date.now();
  for (;;) {
    const tree = await json<ScanTreeResponse>(`${WORKER}/api/scans/${scanId}`);
    const done = tree.tasks.filter((task) => isTerminalState(task.state)).length;
    console.log(
      `${Math.round((Date.now() - started) / 1000)}s  ${tree.scan.status}  pages=${tree.scan.pages.length}  tasks=${tree.tasks.length}  runs done=${done}/${tree.tasks.length}  ${tree.scan.message ?? ""}`,
    );
    if (isScanFinished(tree.scan.status)) return tree;
    if (Date.now() - started > DEADLINE_MS) fail("the scan did not finish within 5 minutes");
    await new Promise((resume) => setTimeout(resume, 3000));
  }
}

let repo: string | undefined;
if (WITH_PRS) {
  const health = await json<OrchestratorHealth>(`${ORCHESTRATOR}/health`);
  if (!health.githubDryRun) fail("SMOKE_PR needs an orchestrator that only previews pull requests (mock mode, or GITHUB_DRY_RUN=1)");
  repo = health.repos?.[0];
  if (!repo) fail("the orchestrator offers no repository");
  const refused = await fetch(`${ORCHESTRATOR}/scans`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: TARGET, repo: "someone-else/not-allowed" }) });
  if (refused.status !== 400) fail(`a repository off the allow-list must be refused with 400, got ${refused.status}`);
}

const { scanId } = await json<CreateScanResponse>(`${ORCHESTRATOR}/scans`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(repo ? { url: TARGET, repo, autoPr: true } : { url: TARGET }),
});
console.log(`scan ${scanId} started for ${TARGET}${repo ? `, pull requests previewed against ${repo}` : ""}`);

const tree = await follow(scanId);
if (tree.scan.status !== "completed") fail(`scan ended as ${tree.scan.status}: ${tree.scan.message ?? ""}`);
if (tree.scan.taskSource !== "mock") fail(`expected taskSource "mock", got ${tree.scan.taskSource}`);
if (tree.scan.pages.length !== 3) fail(`expected 3 crawled pages, got ${tree.scan.pages.length}`);
if (tree.tasks.length !== 10) fail(`expected 10 tasks, got ${tree.tasks.length}`);
if (!tree.tasks.every((task) => isTerminalState(task.state))) fail("the scan completed with runs still going");
if (!tree.tasks.every((task) => task.status === "completed")) fail("the scan completed with runs still verifying");

const report = await json<ScanReportResponse>(`${WORKER}/api/scans/${scanId}/report`);
if (report.issues.length === 0) fail("the report has no issues");
const widest = Math.max(...report.issues.map((issue) => issue.runsHit));
// Every task replays the golden run, so some issue must be hit by every one of them.
if (widest < 10) fail(`expected some issue to hit all 10 runs, widest was ${widest}`);
console.log(`report: ${report.issues.length} issues, widest hit ${widest}/${report.issues[0]?.totalRuns ?? 0} runs, verdicts ${JSON.stringify(report.summary.verdicts)}`);

if (WITH_PRS) {
  const pullRequests = tree.pullRequests ?? [];
  for (const pr of pullRequests) {
    const detail =
      pr.status === "dry_run"
        ? `${pr.branch}  "${pr.preview?.title}"  ${pr.preview?.files.map((file) => `${file.path} +${file.addedLines} -${file.removedLines}`).join(", ")}`
        : pr.status === "covered"
          ? `by ${typeof pr.coveredBy === "number" ? `task ${pr.coveredBy + 1}` : pr.coveredBy}`
          : (pr.reason ?? "");
    console.log(`  T${pr.taskIndex + 1}  ${pr.status.padEnd(14)} ${detail}`);
    for (const item of pr.notFixed) console.log(`        not fixed ${item.findingId}: ${item.reason}`);
  }
  if (tree.scan.repo !== repo || tree.scan.autoPr !== true) fail(`the scan did not record its repository: ${tree.scan.repo} / ${tree.scan.autoPr}`);
  if (pullRequests.length !== tree.tasks.length) fail(`expected a pull request status for each of ${tree.tasks.length} tasks, got ${pullRequests.length}`);
  if (pullRequests.some((pr) => pr.status === "opened" || pr.prUrl)) fail("a dry run opened a pull request");
  const previews = pullRequests.filter((pr) => pr.status === "dry_run");
  // Every task replays the golden run and hits the same file, so exactly one task previews it and the rest are covered by it.
  if (previews.length !== 1 || previews[0]?.taskIndex !== 0) fail(`expected one preview, on task 1; got ${previews.map((pr) => pr.taskIndex + 1).join(", ") || "none"}`);
  if (!previews[0]?.preview?.body.includes("## Also unblocks")) fail("the preview does not list the tasks it also unblocks");
  if (!previews[0]?.preview?.body.includes("## Found, not fixed")) fail("the preview does not list what was found but not fixed");
  if (!previews[0]?.preview?.files.every((file) => isCommittablePath(file.path))) fail("the preview touches a guarded path");
  const covered = pullRequests.filter((pr) => pr.status === "covered" && pr.coveredBy === 0);
  if (covered.length !== tree.tasks.length - 1) fail(`expected the other ${tree.tasks.length - 1} tasks to be covered by task 1, got ${covered.length}`);
  if (!report.summary.pullRequests || !tree.scan.message?.includes(report.summary.pullRequests.text)) fail(`the scan's final message lacks the pull request total: ${tree.scan.message}`);
  console.log(`pull requests: ${report.summary.pullRequests.text}`);
}
console.log(`OK  open http://localhost:5173/?scan=${scanId}`);
