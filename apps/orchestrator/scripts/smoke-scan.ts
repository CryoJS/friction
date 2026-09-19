/**
 * End-to-end check of a scan, in mock mode: no keys, no browser.
 *
 *   pnpm dev:worker
 *   FRICTION_MOCK=1 pnpm dev:orchestrator
 *   pnpm --filter @friction/orchestrator smoke:scan [url]
 *
 * Starts a scan, follows the tree until it finishes, then checks the merged
 * report. Exits 1 on the first thing that is wrong.
 */
import { isScanFinished, isTerminalState, type CreateScanResponse, type ScanReportResponse, type ScanTreeResponse } from "@friction/shared";

const ORCHESTRATOR = (process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
const WORKER = (process.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const TARGET = process.argv[2] ?? `${WORKER}/demo-shop/`;
const DEADLINE_MS = 5 * 60_000;

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

const { scanId } = await json<CreateScanResponse>(`${ORCHESTRATOR}/scans`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: TARGET }),
});
console.log(`scan ${scanId} started for ${TARGET}`);

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
console.log(`OK  open http://localhost:5173/?scan=${scanId}`);
