/**
 * Generates fixtures/golden-run.json: the demo safety net and the frontend's
 * dev fixture. Deterministic (no clock, no randomness) so re-running it gives a
 * byte-identical file.
 *
 *   pnpm golden:generate
 *
 * The story: one agent, a competent first-time visitor, tries to "find a
 * winter jacket and add it to cart" on a fictional store. It gets past a
 * newsletter modal and a slow product page, then "Add to cart" silently
 * ignores every click because no size is selected. It hits that wall again and
 * again, and abandons after four failed attempts.
 *
 * Then the top two findings are verified, one after another, in the verify
 * lane: a fix is proposed, the same task is re-run in a fresh session with it
 * installed, and the result is compared with the primary run.
 *   f13 dead_click  "Please select a size" + focus   -> verified, mapped to a file
 *   f15 retry       a pressed "Adding..." state only  -> rejected: retry still fires
 * Nothing in the fixture opens a pull request: there is no repository behind
 * a fictional shop, and a made-up PR link would be a lie.
 *
 * Every friction below is one the deterministic detectors find on their own
 * from the step data; friction.test.ts holds the fixture to that. Repeat hits
 * of the same finding (same category + selector) are re-emitted under the same
 * findingId with a growing hitCount, exactly as the orchestrator does.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT,
  MOCK_LAYOUT as L,
  RunSnapshotSchema,
  judgeVerification,
  stateForOutcome,
  validatePatch,
  type ActionType,
  type FixPayload,
  type LaneResult,
  type BBox,
  type FrictionCategory,
  type Lane,
  type Outcome,
  type RunEvent,
  type RunSnapshot,
  type Severity,
  type StepSignals,
} from "../packages/shared/src/index";

const ORIGIN = "https://shop.northpeak.example";
const RUN_ID = "golden";
const T0 = Date.UTC(2026, 8, 19, 14, 0, 0);
const VIEWPORT = { w: 1280, h: 720 };
const CAPTURE_MS = 250;

const MODAL = "Get 10% off your first order";
const ADD_TO_CART = "xpath=/html/body/main/div/div[2]/form/button";

interface Judgement {
  severity: Severity;
  confidence: number;
  /** model latency before the judgement lands */
  judgeMs: number;
  summary: string;
  whyItMatters: string;
  recommendation: string;
}

/** A detector hit on a step. The first hit of a finding carries its judgement; repeats reuse it. */
interface FrictionSpec {
  category: FrictionCategory;
  /** Dedupe identity (category + selector), as the detectors compute it. */
  findingKey: string;
  judgement?: Judgement;
}

interface StepSpec {
  /** planning latency before the action */
  think: number;
  /** path the action is performed on */
  at: string;
  /** path afterwards (defaults to `at`) */
  after?: string;
  action: ActionType;
  label: string;
  selector: string;
  bbox: BBox | null;
  value?: string;
  rationale: string;
  duration: number;
  domChanged: boolean;
  signals?: StepSignals;
  friction?: FrictionSpec[];
}

interface LaneScript {
  lane: Lane;
  /** ms after T0 at which the browser session is up */
  sessionUpMs: number;
  steps: StepSpec[];
  ending: { outcome: Outcome; message: string; summary: string };
}

/* ----------------------------------------------------------------- primary */

const primary: LaneScript = {
  lane: "primary",
  sessionUpMs: 3100,
  steps: [
    { think: 1100, at: "/", action: "navigate", label: "", selector: "", bbox: null, value: `${ORIGIN}/`, rationale: "I'm opening the store's home page.", duration: 1950, domChanged: true },
    { think: 2600, at: "/", action: "click", label: "Accept all cookies", selector: "xpath=/html/body/div[3]/div/div[2]/button[2]", bbox: L.cookieAccept, rationale: "A cookie banner covers the bottom of the page; accepting it is the quickest way to clear it.", duration: 250, domChanged: true },
    { think: 2900, at: "/", after: "/collections/men", action: "click", label: "Men", selector: "xpath=/html/body/header/div/nav/ul/li[1]/a", bbox: L.navMen, rationale: "Winter jackets will be under a clothing category, so I'll start with Men in the main menu.", duration: 1800, domChanged: true },
    { think: 2700, at: "/collections/men", after: "/collections/mens-jackets", action: "click", label: "Jackets & Coats", selector: "xpath=/html/body/main/div[2]/a[1]", bbox: L.categoryTile(0), rationale: "'Jackets & Coats' is exactly the category I need.", duration: 2100, domChanged: true },
    {
      think: 2800, at: "/collections/mens-jackets", action: "scroll", label: "", selector: "", bbox: null, value: "down",
      rationale: "I'll scroll to see which jackets are on offer.", duration: 520, domChanged: true,
      signals: { modalAppeared: true, modalLabel: MODAL },
      friction: [{
        category: "modal_interrupt", findingKey: `modal_interrupt:modal:${MODAL.toLowerCase()}`,
        judgement: {
          severity: 3, confidence: 0.84, judgeMs: 1500,
          summary: `An overlay ("${MODAL}") appeared and covered the page.`,
          whyItMatters: "A newsletter prompt covered the product list twenty seconds into the visit, before the visitor had looked at a single product. They had to stop and find the decline link before they could carry on.",
          recommendation: "Delay the newsletter prompt until the visitor has shown intent (added to cart, or viewed two products), or use a non-blocking banner, and make the decline action a clearly labelled button.",
        },
      }],
    },
    { think: 2900, at: "/collections/mens-jackets", action: "click", label: "No thanks", selector: "xpath=/html/body/div[5]/div/div/button[2]", bbox: L.modalDecline, rationale: "I don't want the newsletter, so I'll close it with 'No thanks'.", duration: 300, domChanged: true },
    {
      think: 2600, at: "/collections/mens-jackets", after: "/products/alpine-down-parka", action: "click", label: "Alpine Down Parka", selector: "xpath=/html/body/main/div[2]/article[1]/a", bbox: L.productName(0),
      rationale: "The Alpine Down Parka is clearly a winter jacket; I'll open it.", duration: 6400, domChanged: true,
      friction: [{
        category: "long_wait", findingKey: "long_wait:xpath=/html/body/main/div[2]/article[1]/a",
        judgement: {
          severity: 3, confidence: 0.86, judgeMs: 1300,
          summary: 'click on "Alpine Down Parka" took 6.4s to settle.',
          whyItMatters: "A visitor who has already found the product is left looking at an unresponsive page for more than six seconds. Many will assume the click failed and click again or leave.",
          recommendation: "Get the product page interactive in under 2.5s: server-render the above-the-fold content, defer the reviews and recommendations widgets, and show a skeleton immediately on navigation.",
        },
      }],
    },
    {
      think: 2400, at: "/products/alpine-down-parka", action: "click", label: "Add to cart", selector: ADD_TO_CART, bbox: L.addToCart,
      rationale: "The parka is in Black and the price is shown, so I'll add it to my cart.", duration: 190, domChanged: false,
      friction: [{
        category: "dead_click", findingKey: `dead_click:${ADD_TO_CART}`,
        judgement: {
          severity: 5, confidence: 0.93, judgeMs: 1400,
          summary: 'Clicked "Add to cart" and nothing happened: no navigation, no DOM change.',
          whyItMatters: "The primary conversion button silently ignores the click while no size is selected. There is no error, no highlight and no disabled state, so the visitor cannot tell what is wrong or what to do next.",
          recommendation: 'Never fail silently on the primary CTA. When "Add to cart" is pressed with no size chosen, scroll to the size selector, outline it and announce "Please select a size" in an inline message.',
        },
      }],
    },
    {
      think: 1900, at: "/products/alpine-down-parka", action: "click", label: "Add to cart", selector: ADD_TO_CART, bbox: L.addToCart,
      rationale: "Nothing seemed to happen, so I'll click it once more in case the first click didn't register.", duration: 180, domChanged: false,
      friction: [{
        category: "retry", findingKey: `retry:${ADD_TO_CART}`,
        judgement: {
          severity: 4, confidence: 0.9, judgeMs: 1200,
          summary: 'Repeated click on "Add to cart" straight after the first attempt.',
          whyItMatters: "A second identical click confirms the visitor believed the first one failed. Without feedback they have no way to know the button is waiting for a size.",
          recommendation: "Give immediate feedback on every press of the primary button (pressed state, spinner or inline validation) so a retry is never needed.",
        },
      }],
    },
    { think: 2300, at: "/products/alpine-down-parka", action: "scroll", label: "", selector: "", bbox: null, value: "down", rationale: "I'll look below the button for an error message or a note about why it isn't working.", duration: 430, domChanged: true },
    { think: 2100, at: "/products/alpine-down-parka", action: "scroll", label: "", selector: "", bbox: null, value: "up", rationale: "Nothing down there but shipping details; back up to the button.", duration: 420, domChanged: true },
    { think: 2800, at: "/products/alpine-down-parka", action: "click", label: "Colour: Black", selector: "xpath=/html/body/main/div/div[2]/form/fieldset[1]/label[1]", bbox: L.colourSwatch(0), rationale: "Maybe it wants the colour chosen explicitly, even though Black looks selected; I'll click it.", duration: 210, domChanged: true },
    {
      think: 2200, at: "/products/alpine-down-parka", action: "click", label: "Add to cart", selector: ADD_TO_CART, bbox: L.addToCart,
      rationale: "Black is definitely selected now, so adding to cart should work.", duration: 200, domChanged: false,
      friction: [
        { category: "dead_click", findingKey: `dead_click:${ADD_TO_CART}` },
        {
          category: "step_budget", findingKey: "step_budget:run",
          judgement: {
            severity: 3, confidence: 0.78, judgeMs: 1100,
            summary: "13 steps taken without completing the task (budget: 12).",
            whyItMatters: "Adding one jacket to the cart should take a first-time visitor six to eight steps. Needing more than twelve means the path is padded with interruptions and dead ends.",
            recommendation: "Shorten the happy path: remove the pre-intent newsletter modal and make the product page tell the visitor what it needs before they can add to cart.",
          },
        },
      ],
    },
    {
      think: 1700, at: "/products/alpine-down-parka", action: "click", label: "Add to cart", selector: ADD_TO_CART, bbox: L.addToCart,
      rationale: "Still nothing. One last try before I give up on this site.", duration: 190, domChanged: false,
      friction: [{ category: "retry", findingKey: `retry:${ADD_TO_CART}` }],
    },
  ],
  ending: {
    outcome: "failure",
    message: 'Abandoned: "Add to cart" did nothing, four times.',
    summary: "Gave up after four dead clicks on Add to cart. Never learned that a size was required.",
  },
};

/* ---------------------------------------------------------------- assemble */

type Draft = Omit<RunEvent, "seq"> & { seq?: number; order: number; evidenceStep?: number; findingKey?: string };

interface BuiltLane {
  events: RunEvent[];
  outcome: Outcome;
  steps: number;
  durationMs: number;
  lastTs: number;
  lastSeq: number;
}

function build(script: LaneScript, startMs: number, firstSeq: number, fixId?: string): BuiltLane {
  const drafts: Draft[] = [];
  let order = 0;
  const push = (draft: Omit<Draft, "order" | "runId" | "lane">): void => {
    drafts.push({ ...draft, runId: RUN_ID, lane: script.lane, ...(fixId ? { fixId } : {}), order: order++ } as Draft);
  };
  const t0 = T0 + startMs;

  push({ ts: t0 + 60, type: "status", payload: { state: "idle", currentSeq: 0, message: "Queued. Starting a Browserbase session." } });
  push({ ts: t0 + script.sessionUpMs, type: "status", payload: { state: "running", currentSeq: 0, message: "Session is up." } });

  const judgements = new Map<string, Judgement>();
  const hits = new Map<string, number>();
  let clock = t0 + script.sessionUpMs;
  let latest = clock;
  let frictionCount = 0;
  script.steps.forEach((step, index) => {
    clock += step.think + step.duration + CAPTURE_MS;
    latest = Math.max(latest, clock);
    const stepNumber = index + 1;
    push({
      ts: clock,
      type: "step",
      evidenceStep: stepNumber,
      payload: {
        url: `${ORIGIN}${step.at}`,
        actionType: step.action,
        targetLabel: step.label,
        selector: step.selector,
        rationale: step.rationale,
        screenshotKey: `golden/${script.lane}/${String(stepNumber + firstSeq).padStart(3, "0")}.svg`,
        bbox: step.bbox,
        durationMs: step.duration,
        domChanged: step.domChanged,
        ...(step.value === undefined ? {} : { value: step.value }),
        viewport: VIEWPORT,
        signals: { urlAfter: `${ORIGIN}${step.after ?? step.at}`, ...step.signals },
      },
    });
    for (const friction of step.friction ?? []) {
      const hitCount = (hits.get(friction.findingKey) ?? 0) + 1;
      hits.set(friction.findingKey, hitCount);
      if (friction.judgement) judgements.set(friction.findingKey, friction.judgement);
      const judgement = judgements.get(friction.findingKey);
      if (!judgement) throw new Error(`${friction.findingKey}: first hit must carry a judgement`);
      // A repeat is re-emitted at once with the stored judgement; only a first hit waits on the model.
      const ts = clock + (hitCount === 1 ? judgement.judgeMs : 40);
      latest = Math.max(latest, ts);
      frictionCount += hitCount === 1 ? 1 : 0;
      push({
        ts,
        type: "friction",
        evidenceStep: stepNumber,
        findingKey: friction.findingKey,
        payload: {
          category: friction.category,
          severity: judgement.severity,
          evidenceSeq: -1,
          recommendation: judgement.recommendation,
          confidence: judgement.confidence,
          summary: judgement.summary,
          whyItMatters: judgement.whyItMatters,
          judgedBy: "model",
          findingKey: friction.findingKey,
          selector: step.selector,
          hitCount,
          lastSeq: -1,
        },
      });
    }
  });

  const state = stateForOutcome(script.ending.outcome);
  push({ ts: latest + 350, type: "status", payload: { state, currentSeq: 0, message: script.ending.message } });
  push({
    ts: latest + 450,
    type: "done",
    payload: {
      outcome: script.ending.outcome,
      totalSteps: script.steps.length,
      frictionCount,
      durationMs: latest + 450 - t0,
      summary: script.ending.summary,
    },
  });

  // seq follows emission order, which is timestamp order within a lane.
  drafts.sort((a, b) => a.ts - b.ts || a.order - b.order);
  const seqOfStep = new Map<number, number>();
  drafts.forEach((draft, index) => {
    draft.seq = firstSeq + index + 1;
    if (draft.type === "step" && draft.evidenceStep !== undefined) seqOfStep.set(draft.evidenceStep, draft.seq);
  });

  // A finding's evidence is its FIRST hit; its id is the seq of its first friction event.
  const firstEvidence = new Map<string, number>();
  const findingIds = new Map<string, string>();
  const events = drafts.map((draft): RunEvent => {
    const { order: _order, evidenceStep, findingKey, ...event } = draft;
    if (event.type === "friction" && findingKey) {
      const hitSeq = seqOfStep.get(evidenceStep ?? -1) ?? 0;
      if (!firstEvidence.has(findingKey)) firstEvidence.set(findingKey, hitSeq);
      if (!findingIds.has(findingKey)) findingIds.set(findingKey, `f${event.seq}`);
      event.payload = { ...event.payload, evidenceSeq: firstEvidence.get(findingKey) ?? hitSeq, lastSeq: hitSeq, findingId: findingIds.get(findingKey) };
    } else if (event.type === "status") {
      event.payload = { ...event.payload, currentSeq: event.seq ?? 0 };
    }
    return event as RunEvent;
  });

  return {
    events,
    outcome: script.ending.outcome,
    steps: script.steps.length,
    durationMs: latest + 450 - t0,
    lastTs: latest + 450,
    lastSeq: firstSeq + drafts.length,
  };
}

const main = build(primary, 0, 0);

/* ------------------------------------------------------------ verification */

const DEAD_CLICK_PATCH = [
  "// Say what is missing when Add to cart is pressed with no size chosen.",
  "try {",
  '  document.addEventListener("click", function (event) {',
  "    try {",
  '      var button = event.target && event.target.closest ? event.target.closest("form button") : null;',
  '      if (!button || !/add to cart/i.test(button.textContent || "")) return;',
  '      if (document.querySelector("input[name=size]:checked")) return;',
  '      var first = document.querySelector("input[name=size]");',
  '      var group = first && first.closest("fieldset");',
  '      var note = document.getElementById("friction-size-note") || document.createElement("p");',
  '      note.id = "friction-size-note";',
  '      note.setAttribute("role", "alert");',
  '      note.textContent = "Please select a size.";',
  "      if (group && !note.parentNode) group.appendChild(note);",
  '      if (group) group.style.outline = "2px solid #b91c1c";',
  "      if (first) first.focus();",
  "    } catch (inner) {}",
  "  }, true);",
  "} catch (error) {}",
].join("\n");

const RETRY_PATCH = [
  '// Show a pressed "Adding..." state on Add to cart.',
  "try {",
  '  document.addEventListener("click", function (event) {',
  "    try {",
  '      var button = event.target && event.target.closest ? event.target.closest("form button") : null;',
  '      if (!button || !/add to cart/i.test(button.textContent || "")) return;',
  "      var label = button.textContent;",
  '      button.textContent = "Adding...";',
  '      button.setAttribute("aria-busy", "true");',
  "      setTimeout(function () {",
  '        try { button.textContent = label; button.removeAttribute("aria-busy"); } catch (e) {}',
  "      }, 800);",
  "    } catch (inner) {}",
  "  }, true);",
  "} catch (error) {}",
].join("\n");

for (const patch of [DEAD_CLICK_PATCH, RETRY_PATCH]) {
  const problem = validatePatch(patch);
  if (problem) throw new Error(`fixture patch rejected: ${problem}`);
}

/** Steps 1-7 of the primary run (to the product page): a verify run starts over from the same URL. */
const toProduct = primary.steps.slice(0, 7);
const addToCart = (rationale: string, domChanged: boolean, extra: Partial<StepSpec> = {}): StepSpec => ({
  think: 2200, at: "/products/alpine-down-parka", action: "click", label: "Add to cart", selector: ADD_TO_CART, bbox: L.addToCart, rationale, duration: 220, domChanged, ...extra,
});

const verifyDeadClick: LaneScript = {
  lane: "verify",
  sessionUpMs: 2900,
  steps: [
    ...toProduct,
    addToCart("The parka is in Black and the price is shown, so I'll add it to my cart.", true, {
      signals: { errorTexts: ["Please select a size."] },
      friction: [{
        category: "error_text", findingKey: `error_text:${ADD_TO_CART}|please select a size.`,
        judgement: {
          severity: 2, confidence: 0.7, judgeMs: 1200,
          summary: 'Error shown after click on "Add to cart": "Please select a size."',
          whyItMatters: "The page now says what is missing and moves focus to the sizes, so the visitor can recover at once. It still only appears after the click.",
          recommendation: 'Make the size requirement visible before the click, for example a "Select a size" prompt above the options.',
        },
      }],
    }),
    { think: 2100, at: "/products/alpine-down-parka", action: "click", label: "L", selector: "xpath=/html/body/main/div/div[2]/form/fieldset[2]/label[4]", bbox: L.sizeOption(3), rationale: "It needs a size; the sizes are highlighted, so I'll pick L.", duration: 200, domChanged: true },
    addToCart("L is selected now, so I'll add it to the cart.", true),
    { think: 2300, at: "/products/alpine-down-parka", after: "/cart", action: "click", label: "View cart", selector: "xpath=/html/body/div[7]/aside/a", bbox: L.cartDrawerView, rationale: "A panel says it was added; I'll open the cart to confirm.", duration: 1700, domChanged: true },
  ],
  ending: { outcome: "success", message: "Task complete: the cart shows the parka in size L.", summary: "Added the Alpine Down Parka in L after the page asked for a size." },
};

const verifyRetry: LaneScript = {
  lane: "verify",
  sessionUpMs: 3000,
  steps: [
    ...toProduct,
    addToCart("The parka is in Black and the price is shown, so I'll add it to my cart.", true),
    addToCart("It flashed 'Adding...' but the cart is still empty; I'll try again.", true, {
      friction: [{
        category: "retry", findingKey: `retry:${ADD_TO_CART}`,
        judgement: {
          severity: 4, confidence: 0.86, judgeMs: 1200,
          summary: 'Repeated click on "Add to cart" straight after the first attempt.',
          whyItMatters: "The button now reacts, but nothing is added and nothing says why, so the visitor still has to guess.",
          recommendation: "Feedback alone is not enough: tell the visitor what is missing (the size) when the add cannot go through.",
        },
      }],
    }),
    { think: 2300, at: "/products/alpine-down-parka", action: "scroll", label: "", selector: "", bbox: null, value: "down", rationale: "Looking for a message about why nothing was added.", duration: 430, domChanged: true },
    { think: 2100, at: "/products/alpine-down-parka", action: "scroll", label: "", selector: "", bbox: null, value: "up", rationale: "Nothing below; back up to the button.", duration: 420, domChanged: true },
    { think: 2700, at: "/products/alpine-down-parka", action: "click", label: "Colour: Black", selector: "xpath=/html/body/main/div/div[2]/form/fieldset[1]/label[1]", bbox: L.colourSwatch(0), rationale: "Maybe it wants the colour chosen explicitly; I'll click Black.", duration: 210, domChanged: true },
    addToCart("Black is selected, so this should go through now.", true, {
      friction: [{
        category: "step_budget", findingKey: "step_budget:run",
        judgement: {
          severity: 3, confidence: 0.78, judgeMs: 1100,
          summary: "13 steps taken without completing the task (budget: 12).",
          whyItMatters: "The pressed state made the button feel alive, but the visitor is no closer to a jacket in the cart.",
          recommendation: "Tell the visitor that a size is required at the moment the add fails.",
        },
      }],
    }),
    addToCart("It says Adding... every time and then nothing. Once more.", true, { friction: [{ category: "retry", findingKey: `retry:${ADD_TO_CART}` }] }),
    addToCart("Last try before I give up on this.", true),
  ],
  ending: { outcome: "timeout", message: "Hit the 15-step cap without completing the task.", summary: "The button now shows it was pressed, but nothing is ever added and nothing says why." },
};

const primaryResult: LaneResult = { outcome: main.outcome, steps: main.steps, durationMs: main.durationMs };
const fixEvents: RunEvent[] = [];
const verifyEvents: RunEvent[] = [];
let verifySeq = 0;
let clock = main.lastTs + 1500;

function fix(ts: number, payload: FixPayload): void {
  verifySeq += 1;
  fixEvents.push({ runId: RUN_ID, lane: "verify", seq: verifySeq, ts, fixId: payload.findingId, type: "fix", payload });
}

interface FixStory {
  findingId: string;
  category: FixPayload["category"] & string;
  summary: string;
  patchJs: string;
  script: LaneScript;
  /** Where the verified fix maps in the repository; null leaves it unmapped. */
  sourceFile: string | null;
}

const stories: FixStory[] = [
  {
    findingId: "f13",
    category: "dead_click",
    summary: 'Shows "Please select a size", outlines the sizes and focuses them when Add to cart is pressed with no size chosen.',
    patchJs: DEAD_CLICK_PATCH,
    script: verifyDeadClick,
    sourceFile: "src/components/ProductForm.tsx",
  },
  {
    findingId: "f15",
    category: "retry",
    summary: 'Gives Add to cart an immediate pressed "Adding..." state so every press visibly registers.',
    patchJs: RETRY_PATCH,
    script: verifyRetry,
    sourceFile: null,
  },
];

for (const story of stories) {
  const base: FixPayload = { findingId: story.findingId, stage: "proposed", summary: story.summary, patchJs: story.patchJs, sourceFile: null, before: null, after: null, prUrl: null, category: story.category };
  fix(clock, base);
  clock += 2600;
  fix(clock, { ...base, stage: "verifying", before: primaryResult, note: "Re-running the task with the fix applied." });

  const run = build(story.script, clock - T0 + 200, verifySeq, story.findingId);
  verifyEvents.push(...run.events);
  verifySeq = run.lastSeq;
  clock = run.lastTs + 400;

  const after: LaneResult = { outcome: run.outcome, steps: run.steps, durationMs: run.durationMs };
  const hits = run.events.filter((e) => e.type === "friction" && e.payload.category === story.category).reduce((n, e) => Math.max(n, e.type === "friction" ? (e.payload.hitCount ?? 1) : 0), 0);
  const verdict = judgeVerification({ category: story.category, before: primaryResult, after: { result: after, errored: false, patchActive: true, categoryHits: hits, reachedFindingPage: true } });
  const decided: FixPayload = { ...base, stage: verdict.stage, before: primaryResult, after, note: verdict.note, liveViewUrl: null, replayUrl: null };
  fix(clock, decided);
  if (verdict.stage === "verified" && story.sourceFile) {
    clock += 3200;
    fix(clock, { ...decided, sourceFile: story.sourceFile });
  }
  clock += 1200;
}

const events = [...main.events, ...verifyEvents, ...fixEvents].sort((a, b) => a.ts - b.ts || (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : a.seq - b.seq));
const lastTs = events[events.length - 1]?.ts ?? T0;

const snapshot: RunSnapshot = {
  run: {
    id: RUN_ID,
    url: `${ORIGIN}/`,
    task: "Find a winter jacket and add it to cart",
    status: "completed",
    createdAt: T0,
    completedAt: lastTs,
    state: stateForOutcome(main.outcome),
    outcome: main.outcome,
    totalSteps: main.steps,
    durationMs: main.durationMs,
    liveViewUrl: null,
    sessionId: null,
    replayUrl: null,
  },
  events,
  source: "fixture",
};

// Fail loudly here rather than in three apps at once.
const parsed = RunSnapshotSchema.parse(snapshot);
if (primary.steps.filter((s) => s.friction?.some((f) => f.category === "dead_click" || f.category === "retry")).length < AGENT.maxFailedAttempts) {
  throw new Error("the story says the agent abandons after maxFailedAttempts dead clicks; the script disagrees");
}

const outFile = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/golden-run.json");
writeFileSync(outFile, `${JSON.stringify(parsed, null, 2)}\n`);

const frictions = parsed.events.filter((e) => e.type === "friction");
console.log(`wrote ${outFile}`);
console.log(`  ${parsed.events.length} events over ${((lastTs - T0) / 1000).toFixed(1)}s of run time`);
console.log(`  primary  ${parsed.run.state.padEnd(10)} steps=${main.steps} friction events=${frictions.length}`);
for (const e of frictions) {
  if (e.type === "friction") console.log(`    ${e.lane.padEnd(7)} ${e.fixId ?? "   "} ${e.payload.findingId} ${e.payload.category.padEnd(16)} hit ${e.payload.hitCount} @ step seq ${e.payload.lastSeq}`);
}
for (const e of parsed.events) {
  if (e.type === "fix") console.log(`  fix ${e.payload.findingId} seq ${String(e.seq).padStart(3)} ${e.payload.stage.padEnd(10)} ${e.payload.note ?? ""}${e.payload.sourceFile ? ` [${e.payload.sourceFile}]` : ""}`);
}
