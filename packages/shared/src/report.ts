/**
 * Pure report assembly. The Worker feeds it rows from D1; the control room
 * feeds it a snapshot when the Worker is unreachable. Same output either way.
 *
 * The report is about the primary lane. Verify-lane friction exists only to be
 * compared against it, so it never becomes a finding of its own.
 */
import type {
  DataSource,
  ReportEvidence,
  ReportFinding,
  ReportLaneSummary,
  ReportResponse,
  RunRecord,
  RunSnapshot,
} from "./api";
import {
  DEFAULT_VIEWPORT,
  isDoneEvent,
  isFrictionEvent,
  isStepEvent,
  type DoneEvent,
  type FrictionCategory,
  type FrictionEvent,
  type RunEvent,
  type Severity,
  type StepEvent,
} from "./events";

/** A finding before it is joined to its evidence step. */
export interface FindingInput {
  id: string;
  findingKey: string;
  category: FrictionCategory;
  severity: Severity;
  evidenceSeq: number;
  recommendation: string;
  confidence: number;
  summary?: string | null;
  whyItMatters?: string | null;
  hitCount: number;
  selector: string;
}

export function toReportEvidence(step: StepEvent): ReportEvidence {
  const p = step.payload;
  return {
    seq: step.seq,
    ts: step.ts,
    url: p.url,
    actionType: p.actionType,
    targetLabel: p.targetLabel,
    selector: p.selector,
    rationale: p.rationale,
    screenshotKey: p.screenshotKey,
    bbox: p.bbox,
    viewport: p.viewport ?? DEFAULT_VIEWPORT,
    durationMs: p.durationMs,
    value: p.value ?? null,
  };
}

/** Severity desc, then confidence desc, then hits desc, then a stable tiebreak. */
export function compareFindings(a: ReportFinding, b: ReportFinding): number {
  if (a.severity !== b.severity) return b.severity - a.severity;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.hitCount !== b.hitCount) return b.hitCount - a.hitCount;
  return a.evidenceSeq - b.evidenceSeq;
}

/** The id a friction event's finding goes by. Older events without one fall back to their own seq. */
export function findingIdOf(event: FrictionEvent): string {
  return event.payload.findingId ?? `f${event.seq}`;
}

/**
 * Findings implied by the primary lane's friction events. A finding hit
 * several times was emitted several times under one id; the latest emission
 * (highest hitCount) wins.
 */
export function findingsFromEvents(events: readonly RunEvent[]): FindingInput[] {
  const byId = new Map<string, FrictionEvent>();
  for (const e of events) {
    if (!isFrictionEvent(e) || e.lane !== "primary") continue;
    const id = findingIdOf(e);
    const current = byId.get(id);
    if (!current || (e.payload.hitCount ?? 1) >= (current.payload.hitCount ?? 1)) byId.set(id, e);
  }
  return [...byId.entries()].map(([id, e]) => ({
    id,
    findingKey: e.payload.findingKey ?? `${e.payload.category}:${id}`,
    category: e.payload.category,
    severity: e.payload.severity,
    evidenceSeq: e.payload.evidenceSeq,
    recommendation: e.payload.recommendation,
    confidence: e.payload.confidence,
    summary: e.payload.summary ?? null,
    whyItMatters: e.payload.whyItMatters ?? null,
    hitCount: e.payload.hitCount ?? 1,
    selector: e.payload.selector ?? "",
  }));
}

export interface AssembleReportArgs {
  run: RunRecord;
  findings: readonly FindingInput[];
  /** Step events to join evidence from, and done events for outcomes. */
  events: readonly RunEvent[];
  source: DataSource;
  now?: number;
}

export function assembleReport(args: AssembleReportArgs): ReportResponse {
  const { run, findings, events, source } = args;

  const steps = new Map<number, StepEvent>();
  let done: DoneEvent | null = null;
  for (const e of events) {
    if (e.lane !== "primary") continue;
    if (isStepEvent(e)) steps.set(e.seq, e);
    else if (isDoneEvent(e)) done = e;
  }

  const joined: ReportFinding[] = findings
    .map((f) => {
      const step = steps.get(f.evidenceSeq);
      return {
        id: f.id,
        findingKey: f.findingKey,
        category: f.category,
        severity: f.severity,
        confidence: f.confidence,
        recommendation: f.recommendation,
        summary: f.summary ?? null,
        whyItMatters: f.whyItMatters ?? null,
        evidenceSeq: f.evidenceSeq,
        hitCount: f.hitCount,
        selector: f.selector,
        evidence: step ? toReportEvidence(step) : null,
        replayUrl: run.replayUrl,
      };
    })
    .sort(compareFindings);

  const bySeverity: Record<Severity, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byCategory: Partial<Record<FrictionCategory, number>> = {};
  for (const f of joined) {
    bySeverity[f.severity] += 1;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }

  const primary: ReportLaneSummary = {
    state: run.state,
    outcome: done?.payload.outcome ?? run.outcome,
    stepCount: done?.payload.totalSteps ?? run.totalSteps ?? events.filter((e) => e.lane === "primary" && e.type === "step").length,
    durationMs: done?.payload.durationMs ?? run.durationMs,
    sessionId: run.sessionId,
    replayUrl: run.replayUrl,
  };

  return {
    run,
    source,
    generatedAt: args.now ?? Date.now(),
    totals: { findings: joined.length, bySeverity, byCategory },
    findings: joined,
    primary,
  };
}

/** Offline path: derive the whole report from a replay snapshot. */
export function buildReportFromSnapshot(snapshot: RunSnapshot, now?: number): ReportResponse {
  return assembleReport({
    run: snapshot.run,
    findings: findingsFromEvents(snapshot.events),
    events: snapshot.events,
    source: snapshot.source,
    now,
  });
}
