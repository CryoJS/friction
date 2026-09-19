/**
 * Pure report assembly. The Worker feeds it rows from D1; the control room
 * feeds it a snapshot when the Worker is unreachable. Same output either way.
 */
import type {
  DataSource,
  PersonaRecord,
  ReportEvidence,
  ReportFinding,
  ReportPersonaSection,
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
  type PersonaId,
  type RunEvent,
  type Severity,
  type StepEvent,
} from "./events";
import { PERSONAS } from "./personas";

/** A finding before it is joined to its evidence step. */
export interface FindingInput {
  id: string;
  personaId: PersonaId;
  category: FrictionCategory;
  severity: Severity;
  evidenceSeq: number;
  recommendation: string;
  confidence: number;
  summary?: string | null;
  whyItMatters?: string | null;
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

/** Severity desc, then confidence desc, then a stable tiebreak. */
export function compareFindings(a: ReportFinding, b: ReportFinding): number {
  if (a.severity !== b.severity) return b.severity - a.severity;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.personaId !== b.personaId) return a.personaId < b.personaId ? -1 : 1;
  return a.evidenceSeq - b.evidenceSeq;
}

/** Findings implied by the friction events of a run. */
export function findingsFromEvents(events: readonly RunEvent[]): FindingInput[] {
  return events.filter(isFrictionEvent).map((e) => ({
    id: `${e.personaId}:${e.seq}`,
    personaId: e.personaId,
    category: e.payload.category,
    severity: e.payload.severity,
    evidenceSeq: e.payload.evidenceSeq,
    recommendation: e.payload.recommendation,
    confidence: e.payload.confidence,
    summary: e.payload.summary ?? null,
    whyItMatters: e.payload.whyItMatters ?? null,
  }));
}

export interface AssembleReportArgs {
  run: RunRecord;
  personas: readonly PersonaRecord[];
  findings: readonly FindingInput[];
  /** Step events to join evidence from, and done events for outcomes. */
  events: readonly RunEvent[];
  source: DataSource;
  now?: number;
}

export function assembleReport(args: AssembleReportArgs): ReportResponse {
  const { run, personas, findings, events, source } = args;

  const steps = new Map<string, StepEvent>();
  const dones = new Map<PersonaId, DoneEvent>();
  for (const e of events) {
    if (isStepEvent(e)) steps.set(`${e.personaId}:${e.seq}`, e);
    else if (isDoneEvent(e)) dones.set(e.personaId, e);
  }
  const recordByPersona = new Map(personas.map((p) => [p.personaId, p] as const));

  const joined: ReportFinding[] = findings
    .map((f) => {
      const step = steps.get(`${f.personaId}:${f.evidenceSeq}`);
      return {
        id: f.id,
        personaId: f.personaId,
        category: f.category,
        severity: f.severity,
        confidence: f.confidence,
        recommendation: f.recommendation,
        summary: f.summary ?? null,
        whyItMatters: f.whyItMatters ?? null,
        evidenceSeq: f.evidenceSeq,
        evidence: step ? toReportEvidence(step) : null,
        replayUrl: recordByPersona.get(f.personaId)?.replayUrl ?? null,
      };
    })
    .sort(compareFindings);

  const bySeverity: Record<Severity, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byCategory: Partial<Record<FrictionCategory, number>> = {};
  for (const f of joined) {
    bySeverity[f.severity] += 1;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }

  const sections: ReportPersonaSection[] = PERSONAS.map((def) => {
    const record = recordByPersona.get(def.id);
    const done = dones.get(def.id);
    const stepCount =
      done?.payload.totalSteps ??
      record?.stepCount ??
      events.filter((e) => e.personaId === def.id && e.type === "step").length;
    return {
      personaId: def.id,
      displayName: def.displayName,
      state: record?.state ?? "idle",
      outcome: done?.payload.outcome ?? null,
      stepCount,
      durationMs: done?.payload.durationMs ?? null,
      sessionId: record?.sessionId ?? null,
      replayUrl: record?.replayUrl ?? null,
      findings: joined.filter((f) => f.personaId === def.id),
    };
  });

  return {
    run,
    source,
    generatedAt: args.now ?? Date.now(),
    totals: { findings: joined.length, bySeverity, byCategory },
    findings: joined,
    personas: sections,
  };
}

/** Offline path: derive the whole report from a replay snapshot. */
export function buildReportFromSnapshot(snapshot: RunSnapshot, now?: number): ReportResponse {
  return assembleReport({
    run: snapshot.run,
    personas: snapshot.personas,
    findings: findingsFromEvents(snapshot.events),
    events: snapshot.events,
    source: snapshot.source,
    now,
  });
}
