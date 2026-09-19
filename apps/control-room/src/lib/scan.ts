/** Small, pure helpers the scan page, its nodes and its panels share. */
import {
  taskVerdict,
  type AgentState,
  type ScanNode,
  type ScanStatus,
  type ScanTreeResponse,
  type CoveredBy,
  type TaskPullRequestStatus,
  type TaskVerdict,
} from "@friction/shared";
import type { Tone } from "../components/badges";

/** "https://www.shop.example/x" -> "shop.example" */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Status lights follow DESIGN.md: running is the violet glow, done is white, failure is coral. */
export const SCAN_STATUS: Readonly<Record<ScanStatus, { label: string; tone: Tone }>> = {
  crawling: { label: "Crawling", tone: "glow" },
  running: { label: "Running", tone: "glow" },
  completed: { label: "Completed", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Stopped", tone: "warn" },
};

export const VERDICT: Readonly<Record<TaskVerdict, { label: string; tone: Tone }>> = {
  pass: { label: "Pass", tone: "good" },
  fail: { label: "Fail", tone: "bad" },
  pending: { label: "Pending", tone: "idle" },
};

/** A task's pull request chip. Open is white like every finished good thing; a preview is still the violet glow. */
export const TASK_PR: Readonly<Record<TaskPullRequestStatus, { label: string; tone: Tone }>> = {
  opened: { label: "Draft PR", tone: "good" },
  dry_run: { label: "Preview", tone: "glow" },
  covered: { label: "Covered", tone: "idle" },
  nothing_to_fix: { label: "Nothing to fix", tone: "idle" },
  skipped: { label: "PR skipped", tone: "warn" },
  failed: { label: "PR failed", tone: "bad" },
};

/** "Covered by task 3", or by an open pull request from an earlier scan. */
export function coveredByLabel(by: CoveredBy | undefined): string {
  if (typeof by === "number") return `Covered by task ${by + 1}`;
  const number = typeof by === "string" ? /\/pull\/(\d+)/.exec(by)?.[1] : undefined;
  return number ? `Covered by PR #${number}` : "Covered";
}

export const VERDICT_ORDER: readonly TaskVerdict[] = ["pass", "fail", "pending"];

/** In a scan, an idle run is waiting for a browser session: it reads as "Queued". */
export const SCAN_STATE_LABELS: Readonly<Record<AgentState, string>> = {
  idle: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  timeout: "Timed out",
};

/** Runs (one per task) whose full pipeline has finished vs. total. */
export function runProgress(tree: ScanTreeResponse): { done: number; total: number } {
  return { done: tree.tasks.filter((task) => task.status === "completed").length, total: tree.tasks.length };
}

export function totalFindings(tree: ScanTreeResponse): number {
  return tree.tasks.reduce((sum, task) => sum + task.findingCount, 0);
}

export function verdictCounts(tree: ScanTreeResponse): Record<TaskVerdict, number> {
  const counts: Record<TaskVerdict, number> = { pass: 0, fail: 0, pending: 0 };
  for (const task of tree.tasks) counts[taskVerdict(task.state)] += 1;
  return counts;
}

/** A node whose task does not exist (yet) is the root, as the spec says. */
export function resolveScanNode(node: ScanNode, tree: ScanTreeResponse): ScanNode {
  if (node.kind === "root") return node;
  return tree.tasks.some((task) => task.index === node.index) ? node : { kind: "root" };
}
