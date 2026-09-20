/**
 * The site-wide report: every finding of every run in a scan, merged into
 * issues. Pure, like report.ts: the Worker feeds it D1 rows.
 *
 * Two findings are one issue when category, page path and target label match
 * (issueKey). runsHit counts distinct runs (one per task), so the agent
 * tripping over the same thing twice in one run still counts once. Only the
 * primary lane counts: verify-lane friction is compared, never reported.
 */
import type { Severity, StepEvent } from "./events";
import { toReportEvidence, type FindingInput } from "./report";
import { summarizeTaskPullRequests } from "./scanPr";
import {
  issueKey,
  issuePath,
  taskVerdict,
  type ScanIssue,
  type ScanIssueOccurrence,
  type ScanReportResponse,
  type ScanReportSummary,
  type ScanTreeResponse,
  type TaskPullRequest,
} from "./scan";

export interface ScanFindingInput extends FindingInput {
  runId: string;
}

export interface AssembleScanReportArgs {
  /** Supplies the scan, the tasks and every run's state. */
  tree: ScanTreeResponse;
  findings: readonly ScanFindingInput[];
  /** Primary-lane evidence steps of those findings, in any order. Missing ones are tolerated. */
  evidence: readonly StepEvent[];
  /** Each task's pull request outcome. Defaults to the tree's; none on scans without a repository. */
  pullRequests?: readonly TaskPullRequest[];
  now?: number;
}

interface Member {
  finding: ScanFindingInput;
  taskIndex: number;
  step: StepEvent | undefined;
}

/** Severity desc, then confidence desc. Array.sort is stable, so ties keep arrival order. */
function byWeight(a: Member, b: Member): number {
  return b.finding.severity - a.finding.severity || b.finding.confidence - a.finding.confidence;
}

/** Severity desc, reach desc, confidence desc, then key as a stable tiebreak. */
export function compareIssues(a: ScanIssue, b: ScanIssue): number {
  if (a.severity !== b.severity) return b.severity - a.severity;
  if (a.runsHit !== b.runsHit) return b.runsHit - a.runsHit;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function toIssue(key: string, members: readonly Member[], totalRuns: number): ScanIssue {
  const representative = [...members].sort(byWeight)[0] as Member;
  const { finding, step } = representative;
  const occurrences: ScanIssueOccurrence[] = members
    .map((m) => ({
      runId: m.finding.runId,
      taskIndex: m.taskIndex,
      findingId: m.finding.id,
      evidenceSeq: m.finding.evidenceSeq,
      severity: m.finding.severity,
      hitCount: m.finding.hitCount,
    }))
    .sort((a, b) => a.taskIndex - b.taskIndex || a.evidenceSeq - b.evidenceSeq);
  return {
    key,
    category: finding.category,
    severity: finding.severity,
    confidence: Math.max(...members.map((m) => m.finding.confidence)),
    summary: finding.summary ?? null,
    whyItMatters: finding.whyItMatters ?? null,
    recommendation: finding.recommendation,
    page: issuePath(step?.payload.url ?? null),
    targetLabel: step?.payload.targetLabel ?? "",
    detectedAt: step?.ts ?? null,
    runsHit: new Set(members.map((m) => m.finding.runId)).size,
    totalRuns,
    taskIndexes: [...new Set(members.map((m) => m.taskIndex))].sort((a, b) => a - b),
    occurrences,
    evidence: step ? toReportEvidence(step) : null,
  };
}

export function assembleScanReport(args: AssembleScanReportArgs): ScanReportResponse {
  const { tree } = args;
  const taskByRun = new Map(tree.tasks.map((task) => [task.runId, task] as const));
  const steps = new Map(
    args.evidence.filter((step) => step.lane === "primary").map((step) => [`${step.runId}:${step.seq}`, step] as const),
  );
  const totalRuns = tree.tasks.length;

  const groups = new Map<string, Member[]>();
  for (const finding of args.findings) {
    const task = taskByRun.get(finding.runId);
    if (!task) continue;
    const step = steps.get(`${finding.runId}:${finding.evidenceSeq}`);
    const key = issueKey(finding.category, step?.payload.url ?? null, step?.payload.targetLabel ?? "");
    const members = groups.get(key) ?? [];
    members.push({ finding, taskIndex: task.index, step });
    groups.set(key, members);
  }
  const issues = [...groups].map(([key, members]) => toIssue(key, members, totalRuns)).sort(compareIssues);

  const verdicts: ScanReportSummary["verdicts"] = { pass: 0, fail: 0, pending: 0 };
  const pullRequests = args.pullRequests ?? tree.pullRequests ?? [];
  const prByRun = new Map(pullRequests.map((pr) => [pr.runId, pr] as const));
  const tasks = tree.tasks.map((task) => {
    const verdict = taskVerdict(task.state);
    verdicts[verdict] += 1;
    const pullRequest = prByRun.get(task.runId);
    return { index: task.index, runId: task.runId, title: task.title, verdict, ...(pullRequest ? { pullRequest } : {}) };
  });
  const recorded = tasks.flatMap((task) => (task.pullRequest ? [task.pullRequest] : []));

  const issuesBySeverity: Record<Severity, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const issue of issues) issuesBySeverity[issue.severity] += 1;

  return {
    scan: tree.scan,
    generatedAt: args.now ?? Date.now(),
    summary: { verdicts, issuesBySeverity, ...(recorded.length > 0 ? { pullRequests: summarizeTaskPullRequests(recorded) } : {}) },
    tasks,
    issues,
  };
}
