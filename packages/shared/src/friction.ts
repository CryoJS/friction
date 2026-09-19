/**
 * Friction detection. Hybrid on purpose:
 *
 *   1. detectFriction()  PURE, deterministic, fast. An ordered event array in,
 *                        candidate findings out. No clock, no network, no
 *                        mutation, so it is unit-testable offline against the
 *                        fixture, and safe to re-run after every step.
 *   2. judgeCandidate()  One Structured Outputs call per candidate. The model
 *                        never decides WHETHER something happened or WHAT it
 *                        was; it only writes the judgement: severity, why it
 *                        matters, recommendation, confidence.
 *
 * The model call is injected (StructuredCaller) so this package stays free of
 * SDKs and API keys. If the call fails, times out, or returns junk, the
 * candidate's heuristic judgement is used instead: a run never loses a finding
 * because the model hiccuped.
 *
 * Detectors report every OCCURRENCE. Findings are deduplicated per lane by
 * category + selector (findingKey): hitting the same wall three times is one
 * finding with hitCount 3, and that repetition is itself the signal.
 */
import { z } from "zod";
import {
  FRICTION_CATEGORIES,
  FrictionCategorySchema,
  LANES,
  SeveritySchema,
  isDoneEvent,
  isStepEvent,
  type ActionType,
  type FrictionCategory,
  type FrictionPayload,
  type Lane,
  type RunEvent,
  type Severity,
  type StepEvent,
} from "./events";
import { clamp, normalizeUrlForVisit } from "./util";

/* --------------------------------------------------------------- thresholds */

/** step_budget fires on the first step beyond this many. */
export const STEP_BUDGET = 12;
/** long_wait fires when a single action takes longer than this. */
export const LONG_WAIT_MS = 5000;
/** loop fires when the same URL is visited this many times. */
export const LOOP_VISITS = 3;

/** Repeating these means something did not work. Repeated scrolls, waits and key presses are normal. */
const RETRYABLE: ReadonlySet<ActionType> = new Set<ActionType>(["click", "type", "select", "navigate"]);

/* --------------------------------------------------------------- candidates */

export interface HeuristicJudgement {
  severity: Severity;
  confidence: number;
  whyItMatters: string;
  recommendation: string;
}

export interface FrictionCandidate {
  /**
   * Stable identity. Detectors are re-run over a growing event array after
   * every step; callers emit each key once.
   */
  key: string;
  lane: Lane;
  /** Verify lane: which fix's run this came from. */
  fixId?: string;
  category: FrictionCategory;
  /** seq of the step event that evidences the finding. */
  evidenceSeq: number;
  /** Selector of the element involved ("" when the action had no target). */
  selector: string;
  /**
   * Dedupe identity within a lane: category + selector. Occurrences that share
   * it are one finding hit several times (see tallyFindings).
   */
  findingKey: string;
  /** Deterministic one-line description of what was observed. */
  summary: string;
  /** Used verbatim when no model judgement is available. */
  heuristic: HeuristicJudgement;
  /** Observations handed to the judge. Facts only, never conclusions. */
  facts: Record<string, string | number | boolean>;
}

const DEFAULTS: Readonly<Record<FrictionCategory, HeuristicJudgement>> = {
  dead_click: {
    severity: 4,
    confidence: 0.8,
    whyItMatters: "The click does nothing and says nothing, so the user is stuck.",
    recommendation: "Respond to every click: act, look disabled, or say what is missing.",
  },
  loop: {
    severity: 3,
    confidence: 0.7,
    whyItMatters: "The user keeps landing back here with no way forward.",
    recommendation: "Make the next step obvious and keep selections across the round trip.",
  },
  retry: {
    severity: 3,
    confidence: 0.75,
    whyItMatters: "The first attempt showed no result, so the user tried again.",
    recommendation: "Show a loading, success or error state on every action.",
  },
  step_budget: {
    severity: 3,
    confidence: 0.7,
    whyItMatters: "The path is longer than most users will sit through.",
    recommendation: "Cut steps: fewer interstitials, fewer page loads, key options earlier.",
  },
  error_text: {
    severity: 3,
    confidence: 0.75,
    whyItMatters: "The error lands only after the user commits, so it reads as a rejection.",
    recommendation: "Validate inline and say how to fix it, not just what failed.",
  },
  modal_interrupt: {
    severity: 3,
    confidence: 0.7,
    whyItMatters: "An uninvited overlay blocked the page mid-task.",
    recommendation: "Hold overlays until the task is done; make dismissing them one click.",
  },
  long_wait: {
    severity: 3,
    confidence: 0.85,
    whyItMatters: "Waits over five seconds read as broken, and users leave.",
    recommendation: "Cut the response time, or show a skeleton the instant it starts.",
  },
  keyboard_trap: {
    severity: 5,
    confidence: 0.85,
    whyItMatters: "Tab does not move focus, so keyboard users are stuck. Fails WCAG 2.1.2.",
    recommendation: "Move focus into overlays, cycle Tab inside them, restore it on close.",
  },
  ambiguous_label: {
    severity: 2,
    confidence: 0.7,
    whyItMatters: "Controls share one accessible name, so screen-reader users cannot tell them apart.",
    recommendation: "Give each control a unique name that includes its context.",
  },
};

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

function ordinal(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function isTab(key: string): boolean {
  return /(^|\+)tab$/i.test(key.trim());
}

/** Did the page URL change as a result of this step? Falls back to the next step's URL. */
function urlChanged(step: StepEvent, next: StepEvent | undefined): boolean {
  const before = normalizeUrlForVisit(step.payload.url);
  const after = step.payload.signals?.urlAfter;
  if (after !== undefined) return normalizeUrlForVisit(after) !== before;
  return next ? normalizeUrlForVisit(next.payload.url) !== before : false;
}

function isDeadClick(step: StepEvent, next: StepEvent | undefined): boolean {
  const p = step.payload;
  return p.actionType === "click" && !p.domChanged && !p.signals?.actionFailed && !urlChanged(step, next);
}

function sameAction(a: StepEvent | undefined, b: StepEvent | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.payload.actionType === b.payload.actionType &&
    a.payload.targetLabel.trim() !== "" &&
    a.payload.targetLabel.trim().toLowerCase() === b.payload.targetLabel.trim().toLowerCase()
  );
}

/**
 * The selector part of a finding's identity. The element's selector when there
 * is one; otherwise the most specific thing the category is about, so two
 * unrelated selector-less hits never merge into one finding.
 */
function identityOf(category: FrictionCategory, step: StepEvent, facts: FrictionCandidate["facts"]): string {
  const p = step.payload;
  const target = p.selector || (p.targetLabel.trim() ? `label:${p.targetLabel.trim().toLowerCase()}` : `page:${normalizeUrlForVisit(p.url)}`);
  switch (category) {
    case "modal_interrupt":
      return `modal:${String(facts.modalLabel ?? "").toLowerCase()}`;
    case "loop":
      return `page:${normalizeUrlForVisit(p.url)}`;
    case "step_budget":
      return "run";
    case "error_text":
      return `${target}|${String(facts.errorText ?? "").toLowerCase()}`;
    default:
      return target;
  }
}

function detectForTrack(lane: Lane, fixId: string | undefined, events: readonly RunEvent[]): FrictionCandidate[] {
  const steps = events.filter(isStepEvent).sort((a, b) => a.seq - b.seq);
  const success = events.find((e) => isDoneEvent(e) && e.payload.outcome === "success");
  const out: FrictionCandidate[] = [];

  const add = (
    category: FrictionCategory,
    step: StepEvent,
    discriminator: string | number,
    summary: string,
    facts: FrictionCandidate["facts"],
    override: Partial<HeuristicJudgement> = {},
  ): void => {
    const allFacts: FrictionCandidate["facts"] = {
      url: step.payload.url,
      actionType: step.payload.actionType,
      targetLabel: step.payload.targetLabel,
      durationMs: step.payload.durationMs,
      domChanged: step.payload.domChanged,
      ...facts,
    };
    out.push({
      key: `${lane}${fixId ? `/${fixId}` : ""}:${category}:${discriminator}`,
      lane,
      ...(fixId ? { fixId } : {}),
      category,
      evidenceSeq: step.seq,
      selector: step.payload.selector,
      findingKey: `${category}:${identityOf(category, step, allFacts)}`,
      summary,
      heuristic: { ...DEFAULTS[category], ...override },
      facts: allFacts,
    });
  };

  const visits = new Map<string, number>();
  const ambiguousSeen = new Set<string>();
  let lastUrl: string | null = null;

  steps.forEach((step, index) => {
    const p = step.payload;
    const signals = p.signals ?? {};
    const previous = steps[index - 1];
    const beforePrevious = steps[index - 2];
    const next = steps[index + 1];
    const label = p.targetLabel.trim();

    // dead_click: a click executed, and neither the URL nor the DOM changed.
    // A second dead click on the same target is reported as the retry it is.
    if (isDeadClick(step, next) && !(sameAction(previous, step) && previous && isDeadClick(previous, step))) {
      add("dead_click", step, step.seq, `Clicked "${label || "an unlabelled element"}" and nothing happened: no navigation, no DOM change.`, {
        urlAfter: signals.urlAfter ?? p.url,
      });
    }

    // retry: identical actionType + targetLabel twice in a row. Reported once per streak.
    if (RETRYABLE.has(p.actionType) && sameAction(previous, step) && !sameAction(beforePrevious, previous)) {
      add("retry", step, step.seq, `Repeated ${p.actionType} on "${label}" straight after the first attempt.`, {
        firstAttemptSeq: previous?.seq ?? -1,
        firstAttemptChangedDom: previous?.payload.domChanged ?? false,
      });
    }

    // long_wait: one action took longer than five seconds to settle.
    if (p.durationMs > LONG_WAIT_MS) {
      add(
        "long_wait",
        step,
        step.seq,
        `${p.actionType} on "${label || pathOf(p.url)}" took ${(p.durationMs / 1000).toFixed(1)}s to settle.`,
        { thresholdMs: LONG_WAIT_MS },
        p.durationMs > 2 * LONG_WAIT_MS ? { severity: 4 } : {},
      );
    }

    // error_text: error / validation text that was not already showing before this step.
    const before = new Set((previous?.payload.signals?.errorTexts ?? []).map((t) => t.trim().toLowerCase()));
    const fresh = (signals.errorTexts ?? []).filter((t) => t.trim() !== "" && !before.has(t.trim().toLowerCase()));
    const firstError = fresh[0];
    if (firstError !== undefined) {
      add("error_text", step, step.seq, `Error shown after ${p.actionType} on "${label || pathOf(p.url)}": "${firstError}"`, {
        errorText: firstError,
        errorCount: fresh.length,
      });
    }

    // modal_interrupt: an overlay that was not there before now covers the page.
    if (signals.modalAppeared === true) {
      add("modal_interrupt", step, step.seq, `An overlay ("${signals.modalLabel ?? "untitled dialog"}") appeared and covered the page.`, {
        modalLabel: signals.modalLabel ?? "",
        triggeredBy: p.actionType,
      });
    }

    // keyboard_trap: the agent CHOSE to press Tab and focus stayed where it was.
    // Never inferred from other actions: keyboard behaviour is not forced on the agent.
    if (p.actionType === "press" && signals.focusMoved === false && (signals.keysPressed ?? []).some(isTab)) {
      // An empty label means focus never left the page body (e.g. an overlay swallows Tab).
      const stuckOn = signals.focusLabel || label;
      const where = stuckOn ? `stuck on "${stuckOn}"` : "stuck on the page body: nothing focusable could be reached";
      add("keyboard_trap", step, step.seq, `Pressed Tab and focus did not move (${where}).`, {
        keysPressed: (signals.keysPressed ?? []).join(" "),
        focusLabel: signals.focusLabel ?? "",
      });
    }

    // ambiguous_label: the target shares its accessible name with other controls. Once per name.
    const twins = signals.sameLabelCount ?? 0;
    if (twins >= 2 && label !== "" && !ambiguousSeen.has(label.toLowerCase())) {
      ambiguousSeen.add(label.toLowerCase());
      add("ambiguous_label", step, label.toLowerCase(), `${twins} controls on this page share the accessible name "${label}".`, {
        sameLabelCount: twins,
      });
    }

    // loop: a visit is a run of consecutive steps on one URL; the third visit is a loop. Once per URL.
    const url = normalizeUrlForVisit(p.url);
    if (url !== lastUrl) {
      const count = (visits.get(url) ?? 0) + 1;
      visits.set(url, count);
      if (count === LOOP_VISITS) {
        add("loop", step, url, `Landed on ${pathOf(p.url)} for the ${ordinal(count)} time.`, { visits: count, page: pathOf(p.url) });
      }
      lastUrl = url;
    }

    // step_budget: the first step past the budget, with the task still not done.
    if (index === STEP_BUDGET && !(success && success.seq < step.seq)) {
      add("step_budget", step, "exceeded", `${index + 1} steps taken without completing the task (budget: ${STEP_BUDGET}).`, {
        stepsTaken: index + 1,
        budget: STEP_BUDGET,
      });
    }
  });

  return out;
}

/**
 * Every friction candidate (occurrence) evidenced by these events. Pure: same
 * input, same output, input untouched. Accepts one lane's events or a whole
 * run; events may arrive in any order. Each track (the primary lane, and each
 * fix's run in the verify lane) is judged on its own, ordered by seq.
 * Result order: lane (LANES order), then evidence seq.
 */
export function detectFriction(events: readonly RunEvent[]): FrictionCandidate[] {
  const out: FrictionCandidate[] = [];
  for (const lane of LANES) {
    const tracks = new Map<string | undefined, RunEvent[]>();
    for (const e of events) {
      if (e.lane !== lane) continue;
      const track = lane === "verify" ? e.fixId : undefined;
      const list = tracks.get(track);
      if (list) list.push(e);
      else tracks.set(track, [e]);
    }
    for (const [fixId, mine] of tracks) out.push(...detectForTrack(lane, fixId, mine));
  }
  return out.sort((a, b) => (a.lane === b.lane ? a.evidenceSeq - b.evidenceSeq : LANES.indexOf(a.lane) - LANES.indexOf(b.lane)));
}

export interface FindingTally {
  findingKey: string;
  /** The first occurrence: its evidence step is the finding's evidence. */
  first: FrictionCandidate;
  /** Every occurrence, first included, in evidence order. */
  hits: FrictionCandidate[];
}

/** Occurrences grouped into findings by lane + findingKey. Pure; order of first appearance. */
export function tallyFindings(candidates: readonly FrictionCandidate[]): FindingTally[] {
  const byKey = new Map<string, FindingTally>();
  for (const candidate of candidates) {
    const id = `${candidate.lane}|${candidate.fixId ?? ""}|${candidate.findingKey}`;
    const tally = byKey.get(id);
    if (tally) tally.hits.push(candidate);
    else byKey.set(id, { findingKey: candidate.findingKey, first: candidate, hits: [candidate] });
  }
  return [...byKey.values()];
}

/** Candidates whose key is not in `alreadyEmitted`. Convenience for the per-step loop. */
export function newCandidates(events: readonly RunEvent[], alreadyEmitted: ReadonlySet<string>): FrictionCandidate[] {
  return detectFriction(events).filter((candidate) => !alreadyEmitted.has(candidate.key));
}

/* ------------------------------------------------------ error text matching */

export interface A11yTextNode {
  role: string;
  name: string;
  /** aria-invalid on the node (or its control). */
  invalid?: boolean;
}

const ALERT_ROLES = new Set(["alert", "alertdialog", "status", "log"]);
const LOOSE_ERROR = /\b(error|invalid|incorrect|fail(ed|ure)?|unable|cannot|can(')?t|couldn(')?t|not (valid|available|found)|unavailable|out of stock|sold out|required|try again|went wrong|oops|sorry|expired|declined|denied|too (short|long|many)|must (be|contain|have|include)|please (enter|select|choose|provide|check|fix|correct))\b/i;
const STRICT_ERROR = /\b(out of stock|sold out|went wrong|try again|(is|are) required|not valid|invalid|incorrect|an error|error:)\b/i;

/**
 * Error / validation strings in a pruned a11y tree. Pure, so error_text is as
 * deterministic as the rest. Live regions are matched loosely (they exist to
 * announce problems); ordinary text only on unambiguous wording, so marketing
 * copy like "Sorry we missed you" does not become a finding.
 */
export function findErrorTexts(nodes: readonly A11yTextNode[], limit = 5): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const text = node.name.replace(/\s+/g, " ").trim();
    if (text.length < 4 || text.length > 240) continue;
    const role = node.role.toLowerCase();
    const hit = node.invalid === true || (ALERT_ROLES.has(role) ? LOOSE_ERROR.test(text) : STRICT_ERROR.test(text));
    if (!hit || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    found.push(text);
    if (found.length >= limit) break;
  }
  return found;
}

/* ---------------------------------------------------------------- judgement */

export const FrictionJudgementSchema = z.object({
  category: FrictionCategorySchema,
  severity: SeveritySchema,
  whyItMatters: z.string().min(1),
  recommendation: z.string().min(1),
  confidence: z.number(),
});
export type FrictionJudgement = z.infer<typeof FrictionJudgementSchema>;

/**
 * JSON Schema for OpenAI Structured Outputs (strict mode: every key required,
 * additionalProperties false, no numeric range keywords). Ranges are enforced
 * by FrictionJudgementSchema + clamping after the call.
 */
export const FRICTION_JUDGEMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "severity", "whyItMatters", "recommendation", "confidence"],
  properties: {
    category: { type: "string", enum: [...FRICTION_CATEGORIES], description: "Echo the category you were given." },
    severity: { type: "integer", enum: [1, 2, 3, 4, 5], description: "1 cosmetic, 2 minor, 3 moderate, 4 major, 5 blocks the task." },
    whyItMatters: { type: "string", description: "One line, 15 words at most: the concrete cost to this user. No preamble, no restating the observation." },
    recommendation: { type: "string", description: "One line, 15 words at most, starting with a verb: a concrete fix a front-end developer could ship this week." },
    confidence: { type: "number", description: "0 to 1: how sure you are that this is real friction and not an artefact." },
  },
} as const;

export interface StructuredRequest {
  instructions: string;
  input: string;
  schemaName: string;
  schema: typeof FRICTION_JUDGEMENT_JSON_SCHEMA;
}

/** Performs one Structured Outputs call and returns the parsed JSON. May throw. */
export type StructuredCaller = (request: StructuredRequest) => Promise<unknown>;

export interface JudgeContext {
  task: string;
  /** Recent steps of this lane, oldest first, for context. */
  recentSteps: readonly StepEvent[];
}

export function buildJudgeRequest(candidate: FrictionCandidate, context: JudgeContext): StructuredRequest {
  const trail = context.recentSteps
    .slice(-6)
    .map((s) => {
      const p = s.payload;
      const marker = s.seq === candidate.evidenceSeq ? "  <-- evidence" : "";
      return `  #${s.seq} ${p.actionType} "${p.targetLabel}" on ${pathOf(p.url)} (${p.durationMs}ms, domChanged=${p.domChanged}) thinking: ${p.rationale}${marker}`;
    })
    .join("\n");

  return {
    schemaName: "friction_judgement",
    schema: FRICTION_JUDGEMENT_JSON_SCHEMA,
    instructions:
      "You are a senior UX researcher reviewing an automated usability session. " +
      "A deterministic detector has already established WHAT happened; do not dispute it and do not change the category. " +
      "Your job is the judgement: how bad it is for this kind of user, why, and what to fix. " +
      "Be specific to the page and element involved, never generic. Lower your confidence if the evidence could be an automation artefact rather than a real usability problem. " +
      "Write like a bug tracker: each text field is ONE line of 15 words at most, with no preamble, no hedging and no repeating what the detector already observed.",
    input: [
      `Task the user was attempting: ${context.task}`,
      "User: a competent adult visiting the site for the first time.",
      `Detected category: ${candidate.category}`,
      `What the detector observed: ${candidate.summary}`,
      `Facts: ${JSON.stringify(candidate.facts)}`,
      "Recent steps:",
      trail || "  (none)",
    ].join("\n"),
  };
}

export type JudgedBy = "model" | "heuristic";

export interface JudgedFinding extends FrictionJudgement {
  judgedBy: JudgedBy;
}

function heuristicFinding(candidate: FrictionCandidate): JudgedFinding {
  return { category: candidate.category, ...candidate.heuristic, judgedBy: "heuristic" };
}

/**
 * The judgement for one candidate. Never throws and never returns nothing: on
 * any failure the heuristic judgement stands in. The category always stays the
 * detector's, whatever the model says.
 */
export async function judgeCandidate(candidate: FrictionCandidate, context: JudgeContext, call?: StructuredCaller): Promise<JudgedFinding> {
  if (!call) return heuristicFinding(candidate);
  try {
    const parsed = FrictionJudgementSchema.safeParse(await call(buildJudgeRequest(candidate, context)));
    if (!parsed.success) return heuristicFinding(candidate);
    return {
      ...parsed.data,
      category: candidate.category,
      confidence: clamp(parsed.data.confidence, 0, 1),
      judgedBy: "model",
    };
  } catch {
    return heuristicFinding(candidate);
  }
}

/**
 * The friction event payload for a judged finding. `first` is its first
 * occurrence (the evidence); pass `repeat` for a later hit, with the count so far.
 */
export function toFrictionPayload(
  first: FrictionCandidate,
  finding: JudgedFinding,
  repeat?: { hit: FrictionCandidate; hitCount: number },
): FrictionPayload {
  return {
    category: first.category,
    severity: finding.severity,
    evidenceSeq: first.evidenceSeq,
    recommendation: finding.recommendation,
    confidence: Math.round(clamp(finding.confidence, 0, 1) * 100) / 100,
    summary: first.summary,
    whyItMatters: finding.whyItMatters,
    judgedBy: finding.judgedBy,
    findingKey: first.findingKey,
    selector: first.selector,
    hitCount: repeat?.hitCount ?? 1,
    lastSeq: repeat?.hit.evidenceSeq ?? first.evidenceSeq,
  };
}
