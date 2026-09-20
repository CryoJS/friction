/**
 * The pull request yield of one or more finished scans, as the table in
 * prompts/pr-yield.md: what became of every proposed fix, and of every task
 * that found problems. Reads the Worker only; changes nothing.
 *
 *   pnpm --filter @friction/orchestrator yield <scanId> [<scanId> ...]
 */
import type { FixListResponse, ReportResponse, ScanTreeResponse } from "@friction/shared";

const WORKER = (process.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const scanIds = process.argv.slice(2);
if (scanIds.length === 0) {
  console.error("usage: yield <scanId> [<scanId> ...]   (GET /api/scans lists them)");
  process.exit(1);
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(`${WORKER}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
  return (await response.json()) as T;
}

const count = new Map<string, number>();
const bump = (key: string): void => void count.set(key, (count.get(key) ?? 0) + 1);
let tasks = 0;
let clean = 0;
let fixes = 0;
const taskStatuses = new Map<string, number>();

for (const scanId of scanIds) {
  const tree = await json<ScanTreeResponse>(`/api/scans/${scanId}`);
  for (const task of tree.tasks) {
    tasks += 1;
    const report = await json<ReportResponse>(`/api/runs/${task.runId}/report`);
    if (report.findings.length === 0) {
      clean += 1;
      continue;
    }
    const status = tree.pullRequests?.find((pr) => pr.runId === task.runId)?.status ?? "none recorded";
    taskStatuses.set(status, (taskStatuses.get(status) ?? 0) + 1);
    const { fixes: rows } = await json<FixListResponse>(`/api/runs/${task.runId}/fixes`);
    console.log(`${scanId} T${task.index + 1}  ${report.findings.length} findings  pr=${status}`);
    for (const fix of rows) {
      fixes += 1;
      const note = fix.note ?? "";
      const mapped = Boolean(fix.sourceFile);
      const bucket =
        fix.stage === "rejected"
          ? !fix.patchJs
            ? "rejected: no acceptable patch was proposed"
            : /still fires/.test(note)
              ? 'rejected: "<category> still fires"'
              : /never reached/.test(note)
                ? 'rejected: "The agent never reached the page where <category> happened"'
                : "rejected: other"
          : fix.stage === "verified" || fix.stage === "pr_opened"
            ? mapped
              ? "verified and mapped: became a PR or a preview"
              : "verified, but never mapped to a source file"
            : `unfinished (${fix.stage})`;
      bump(bucket);
      if ((fix.attempts ?? 1) > 1) bump("  of which: decided on the second attempt (retry)");
      if (fix.alsoResolved?.length) bump("  symptom findings credited to a verified fix");
      console.log(`    ${fix.findingId} ${fix.category ?? "?"} -> ${fix.stage}${mapped ? ` ${fix.sourceFile}` : ""}${(fix.attempts ?? 1) > 1 ? " (2nd attempt)" : ""} | ${note}${fix.mappingNote ? ` | ${fix.mappingNote}` : ""}`);
    }
  }
}

const verified = [...count.entries()].filter(([key]) => key.startsWith("verified")).reduce((n, [, value]) => n + value, 0);
console.log(`\n${tasks} tasks. ${clean} found nothing. ${tasks - clean} had findings and produced ${fixes} proposed fixes:\n`);
console.log("| What happened to the fix | Count |\n| --- | --- |");
for (const [key, value] of [...count.entries()].sort()) console.log(`| ${key} | ${value} |`);
console.log(`| verified total | ${verified} of ${fixes} |`);
console.log(`\nTasks with findings, by pull request status: ${[...taskStatuses.entries()].map(([status, n]) => `${status} ${n}`).join(", ")}`);
