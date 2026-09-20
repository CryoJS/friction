/**
 * WHICH FINDINGS GET VERIFIED, and what is said about the ones that do not.
 *
 * The run decides with planVerification (shared/fixes.ts). The scan's pull
 * requests, which run later and only see what the Worker stored, re-derive
 * the same plan from the recorded run to explain every finding that ended
 * with no fix: planVerification is pure, so the same findings give the same
 * plan. Nothing is stored for a finding that was never selected.
 */
import {
  describeNotSelected,
  planRetries,
  type FixRecord,
  type FrictionCategory,
  type FrictionPayload,
  type RunSnapshot,
  type SelectableFinding,
  type StepEvent,
  type VerificationPlan,
  type Verdict,
} from "@friction/shared";
import { findingForFix, type FindingForFix } from "./fixer";

export interface Candidate extends SelectableFinding {
  finding: FindingForFix;
}

/** The latest payload of every primary-lane finding, as the verification plan ranks it. */
export function verificationCandidates(payloads: readonly FrictionPayload[], steps: readonly StepEvent[]): Candidate[] {
  return payloads.flatMap((payload) => {
    const finding = findingForFix(payload, steps);
    if (!finding) return [];
    return [{ finding, findingId: finding.findingId, category: finding.category, severity: finding.severity, confidence: payload.confidence, hitCount: finding.hitCount, selector: finding.selector, url: finding.url }];
  });
}

/** The recorded run's findings: per finding, the emission with the final hit count. */
export function recordedCandidates(snapshot: RunSnapshot): Candidate[] {
  const primary = snapshot.events.filter((e) => e.lane === "primary");
  const steps = primary.filter((e): e is StepEvent => e.type === "step").sort((a, b) => a.seq - b.seq);
  const latest = new Map<string, FrictionPayload>();
  for (const event of primary) {
    if (event.type !== "friction" || !event.payload.findingId) continue;
    const known = latest.get(event.payload.findingId);
    if (!known || (event.payload.hitCount ?? 1) >= (known.hitCount ?? 1)) latest.set(event.payload.findingId, event.payload);
  }
  return verificationCandidates([...latest.values()], steps);
}

/**
 * Every finding of the run that has no fix row, with the furthest stage it
 * reached: not selected (and why), or selected but never proposed.
 */
export function unfixedFindings(plan: VerificationPlan<Candidate>, fixes: readonly FixRecord[], mock = false): Array<{ findingId: string; reason: string }> {
  const hasFix = new Set(fixes.map((fix) => fix.findingId));
  return [
    ...plan.selected
      .filter((candidate) => !hasFix.has(candidate.findingId))
      .map((candidate) => ({
        findingId: candidate.findingId,
        reason: mock
          ? "Selected for verification, but mock mode has no recorded verification run for this category."
          : "Selected for verification, but no fix was proposed for it: the run's verifications ran out (VERIFY_MAX_RUNS), or the run ended first.",
      })),
    ...plan.notSelected.filter((entry) => !hasFix.has(entry.finding.findingId)).map((entry) => ({ findingId: entry.finding.findingId, reason: describeNotSelected(entry, entry.finding.category) })),
  ];
}

/** What one verification came to. `ran`: a browser run was spent on it, whatever came of it. */
export interface AttemptResult<R> {
  ran: boolean;
  /** Null: nothing to judge (no patch was proposed, or the attempt failed). */
  outcome: { report: R; verdict: Verdict } | null;
}

/**
 * The order and the budget of a run's verifications; the work itself is the
 * caller's. Every selected finding gets its first attempt, in order, before
 * any retry, so a retry never takes a slot from a finding that has had none.
 * Then planRetries' findings get ONE more attempt each, onto the same report.
 * Runs spent never exceed `maxRuns`. `skip` is asked at each finding's turn,
 * because an earlier verification can make a later one unnecessary.
 */
export async function scheduleVerifications<F extends { findingId: string; category: FrictionCategory }, R>(args: {
  selected: readonly F[];
  maxRuns: number;
  skip: (finding: F) => boolean;
  attempt: (finding: F, retryOf?: R) => Promise<AttemptResult<R>>;
}): Promise<{ used: number; retried: string[] }> {
  let used = 0;
  const firsts: Array<{ finding: F; report: R; verdict: Verdict }> = [];
  for (const finding of args.selected) {
    if (used >= args.maxRuns) break;
    if (args.skip(finding)) continue;
    const result = await args.attempt(finding);
    if (result.ran) used += 1;
    if (result.outcome) firsts.push({ finding, ...result.outcome });
  }

  const retried: string[] = [];
  const retries = planRetries(firsts.map((first) => ({ findingId: first.finding.findingId, category: first.finding.category, verdict: first.verdict, attempts: 1 })), { used, maxRuns: args.maxRuns });
  for (const findingId of retries) {
    const first = firsts.find((entry) => entry.finding.findingId === findingId);
    if (!first || used >= args.maxRuns) continue;
    retried.push(findingId);
    if ((await args.attempt(first.finding, first.report)).ran) used += 1;
  }
  return { used, retried };
}
