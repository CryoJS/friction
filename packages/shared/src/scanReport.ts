/**
 * The site-wide report: every finding of every run in a scan, merged into
 * issues. Pure, like report.ts: the Worker feeds it D1 rows.
 *
 * Two findings are one issue when category, page path and target label match
 * (issueKey). runsHit counts distinct task x persona runs, so one persona
 * tripping over the same thing twice in one run still counts once.
 */
import { PERSONA_IDS, isTerminalState, type PersonaId, type Severity, type StepEvent } from "./events";
import { toReportEvidence, type FindingInput } from "./report";
import {
  issueKey,
  issuePath,
  taskVerdict,
  type ScanIssue,
  type ScanIssueOccurrence,
  type ScanReportResponse,
  type ScanReportSummary,
  type ScanTreeResponse,
  type TaskVerdict,
} from "./scan";

export interface ScanFindingInput extends FindingInput {
  runId: string;
}

export interface AssembleScanReportArgs {
  /** Supplies the scan, the tasks and every persona's state. */
  tree: ScanTreeResponse;
  findings: readonly ScanFindingInput[];
  /** Evidence steps of those findings, in any order. Missing ones are tolerated. */
  evidence: readonly StepEvent[];
  now?: number;
}

interface Member {
  finding: ScanFindingInput;
  taskIndex: number;
  step: StepEvent | undefined;
}

const PERSONA_ORDER = new Map<PersonaId, number>(PERSONA_IDS.map((id, index) => [id, index]));

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
      personaId: m.finding.personaId,
      evidenceSeq: m.finding.evidenceSeq,
      severity: m.finding.severity,
    }))
    .sort(
      (a, b) =>
        a.taskIndex - b.taskIndex ||
        (PERSONA_ORDER.get(a.personaId) ?? 0) - (PERSONA_ORDER.get(b.personaId) ?? 0) ||
        a.evidenceSeq - b.evidenceSeq,
    );
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
    runsHit: new Set(members.map((m) => `${m.finding.runId}:${m.finding.personaId}`)).size,
    totalRuns,
    personas: PERSONA_IDS.filter((id) => members.some((m) => m.finding.personaId === id)),
    taskIndexes: [...new Set(members.map((m) => m.taskIndex))].sort((a, b) => a - b),
    occurrences,
    evidence: step ? toReportEvidence(step) : null,
  };
}

export function assembleScanReport(args: AssembleScanReportArgs): ScanReportResponse {
  const { tree } = args;
  const taskByRun = new Map(tree.tasks.map((task) => [task.runId, task] as const));
  const steps = new Map(args.evidence.map((step) => [`${step.runId}:${step.personaId}:${step.seq}`, step] as const));
  const totalRuns = tree.tasks.length * PERSONA_IDS.length;

  const groups = new Map<string, Member[]>();
  for (const finding of args.findings) {
    const task = taskByRun.get(finding.runId);
    if (!task) continue;
    const step = steps.get(`${finding.runId}:${finding.personaId}:${finding.evidenceSeq}`);
    const key = issueKey(finding.category, step?.payload.url ?? null, step?.payload.targetLabel ?? "");
    const members = groups.get(key) ?? [];
    members.push({ finding, taskIndex: task.index, step });
    groups.set(key, members);
  }
  const issues = [...groups].map(([key, members]) => toIssue(key, members, totalRuns)).sort(compareIssues);

  const verdicts: Record<TaskVerdict, number> = { pass: 0, partial: 0, fail: 0, pending: 0 };
  const personas = Object.fromEntries(
    PERSONA_IDS.map((id) => [id, { succeeded: 0, finished: 0, total: tree.tasks.length }]),
  ) as ScanReportSummary["personas"];
  const tasks = tree.tasks.map((task) => {
    const verdict = taskVerdict(task.personas.map((p) => p.state));
    verdicts[verdict] += 1;
    for (const p of task.personas) {
      if (isTerminalState(p.state)) personas[p.personaId].finished += 1;
      if (p.state === "succeeded") personas[p.personaId].succeeded += 1;
    }
    return { index: task.index, runId: task.runId, title: task.title, verdict };
  });

  const issuesBySeverity: Record<Severity, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const issue of issues) issuesBySeverity[issue.severity] += 1;

  return {
    scan: tree.scan,
    generatedAt: args.now ?? Date.now(),
    summary: { verdicts, personas, issuesBySeverity },
    tasks,
    issues,
  };
}
