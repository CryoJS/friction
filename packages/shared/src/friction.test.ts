/**
 * Friction detector unit tests. Everything here runs offline: the detectors
 * are pure, and the fixture is the oracle.
 *
 *   pnpm test
 */
import { describe, expect, it } from "vitest";
import {
  PERSONAS,
  PERSONA_BY_ID,
  PERSONA_IDS,
  RunSnapshotSchema,
  type FrictionEvent,
  type PersonaId,
  type RunEvent,
  type StepEvent,
  type StepPayload,
} from "./index";
import {
  LONG_WAIT_MS,
  STEP_BUDGET,
  buildJudgeRequest,
  detectFriction,
  findErrorTexts,
  judgeCandidate,
  newCandidates,
  toFrictionPayload,
  type FrictionCandidate,
  type JudgeContext,
} from "./friction";
import { getGoldenRun } from "./golden";
import raw from "../../../fixtures/golden-run.json";

const golden = getGoldenRun();
const tag = (category: string, evidenceSeq: number): string => `${category}@${evidenceSeq}`;

/* ---------------------------------------------------------------- builders */

let clock = 1_800_000_000_000;
function step(personaId: PersonaId, seq: number, overrides: Partial<StepPayload> = {}): StepEvent {
  clock += 1000;
  return {
    runId: "t",
    personaId,
    seq,
    ts: clock,
    type: "step",
    payload: {
      url: "https://shop.example/",
      actionType: "click",
      targetLabel: `Button ${seq}`,
      selector: `#b${seq}`,
      rationale: "because",
      screenshotKey: "",
      bbox: null,
      durationMs: 200,
      domChanged: true,
      ...overrides,
    },
  };
}
const categories = (found: FrictionCandidate[]): string[] => found.map((c) => c.category);

/* ------------------------------------------------------------- the fixture */

describe("golden fixture", () => {
  it("is a valid RunSnapshot", () => {
    expect(RunSnapshotSchema.safeParse(raw).success).toBe(true);
  });

  it("has three personas, 12-18 steps each, 2-4 frictions each, and exactly one unhappy ending", () => {
    let unhappy = 0;
    for (const id of PERSONA_IDS) {
      const mine = golden.events.filter((e) => e.personaId === id);
      const steps = mine.filter((e) => e.type === "step").length;
      const frictions = mine.filter((e) => e.type === "friction").length;
      const done = mine.filter((e) => e.type === "done");
      expect(steps, `${id} steps`).toBeGreaterThanOrEqual(12);
      expect(steps, `${id} steps`).toBeLessThanOrEqual(18);
      expect(frictions, `${id} frictions`).toBeGreaterThanOrEqual(2);
      expect(frictions, `${id} frictions`).toBeLessThanOrEqual(4);
      expect(done).toHaveLength(1);
      if (done[0]?.type === "done" && done[0].payload.outcome !== "success") unhappy += 1;
    }
    expect(unhappy).toBe(1);
  });

  it("is interleaved by timestamp", () => {
    const ts = golden.events.map((e) => e.ts);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    const firstTwenty = new Set(golden.events.slice(6, 20).map((e) => e.personaId));
    expect(firstTwenty.size).toBe(3);
  });
});

describe("detectFriction against the golden fixture", () => {
  const recorded = golden.events.filter((e): e is FrictionEvent => e.type === "friction");

  it.each(PERSONA_IDS)("finds exactly the frictions recorded for %s", (id) => {
    const expected = recorded.filter((e) => e.personaId === id).map((e) => tag(e.payload.category, e.payload.evidenceSeq));
    const found = detectFriction(golden.events.filter((e) => e.personaId === id)).map((c) => tag(c.category, c.evidenceSeq));
    expect(found.sort()).toEqual(expected.sort());
  });

  it("finds the same set when given the whole interleaved run at once", () => {
    const expected = recorded.map((e) => `${e.personaId}:${tag(e.payload.category, e.payload.evidenceSeq)}`);
    const found = detectFriction(golden.events).map((c) => `${c.personaId}:${tag(c.category, c.evidenceSeq)}`);
    expect(found.sort()).toEqual(expected.sort());
    expect(found).toHaveLength(11);
  });

  it("writes the same summaries the fixture recorded", () => {
    const bySummary = new Map(recorded.map((e) => [`${e.personaId}:${tag(e.payload.category, e.payload.evidenceSeq)}`, e.payload.summary]));
    for (const candidate of detectFriction(golden.events)) {
      expect(candidate.summary).toBe(bySummary.get(`${candidate.personaId}:${tag(candidate.category, candidate.evidenceSeq)}`));
    }
  });

  it("covers all nine categories", () => {
    expect(new Set(categories(detectFriction(golden.events))).size).toBe(9);
  });

  it("is order-independent: shuffled input gives the same result", () => {
    const shuffled = [...golden.events].reverse();
    expect(detectFriction(shuffled)).toEqual(detectFriction(golden.events));
  });

  it("is pure: frozen input, identical output on a second call", () => {
    const frozen = JSON.parse(JSON.stringify(golden.events)) as RunEvent[];
    const deepFreeze = (value: unknown): void => {
      if (value && typeof value === "object") {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
    };
    deepFreeze(frozen);
    const first = detectFriction(frozen);
    expect(detectFriction(frozen)).toEqual(first);
  });

  it("works incrementally: every finding appears as soon as its evidence step exists, exactly once", () => {
    const emitted = new Set<string>();
    const firstSeenAt = new Map<string, number>();
    golden.events.forEach((_, index) => {
      const prefix = golden.events.slice(0, index + 1);
      for (const candidate of newCandidates(prefix, emitted)) {
        emitted.add(candidate.key);
        firstSeenAt.set(candidate.key, index);
        const evidenceIndex = prefix.findIndex((e) => e.personaId === candidate.personaId && e.seq === candidate.evidenceSeq);
        // Detected on the very event that evidences it: that is what makes it "real time".
        expect(evidenceIndex, candidate.key).toBe(index);
      }
    });
    expect(emitted.size).toBe(11);
    // A key, once emitted, never changes identity on later runs.
    expect(detectFriction(golden.events).map((c) => c.key).sort()).toEqual([...emitted].sort());
  });
});

/* ------------------------------------------------------- detector by detector */

describe("dead_click", () => {
  it("fires when a click changes neither the URL nor the DOM", () => {
    const events = [step("impatient", 1), step("impatient", 2, { targetLabel: "Buy", domChanged: false })];
    const found = detectFriction(events);
    expect(categories(found)).toEqual(["dead_click"]);
    expect(found[0]?.evidenceSeq).toBe(2);
  });

  it("does not fire when the DOM changed, the URL changed, or the action is not a click", () => {
    expect(detectFriction([step("impatient", 1, { domChanged: true })])).toEqual([]);
    expect(detectFriction([step("impatient", 1, { domChanged: false, signals: { urlAfter: "https://shop.example/next" } })])).toEqual([]);
    expect(detectFriction([step("impatient", 1, { actionType: "scroll", domChanged: false })])).toEqual([]);
  });

  it("infers the URL change from the next step when urlAfter is missing", () => {
    const events = [step("impatient", 1, { domChanged: false }), step("impatient", 2, { url: "https://shop.example/other" })];
    expect(categories(detectFriction(events))).toEqual([]);
  });

  it("ignores a hash-only URL change (same page)", () => {
    const events = [step("impatient", 1, { domChanged: false, signals: { urlAfter: "https://shop.example/#top" } })];
    expect(categories(detectFriction(events))).toEqual(["dead_click"]);
  });

  it("does not blame the site when the action itself could not be executed", () => {
    expect(detectFriction([step("impatient", 1, { domChanged: false, signals: { actionFailed: true } })])).toEqual([]);
  });
});

describe("retry", () => {
  it("fires on the second identical actionType + targetLabel, once per streak", () => {
    const events = [1, 2, 3].map((seq) => step("impatient", seq, { targetLabel: "Add to cart" }));
    const found = detectFriction(events);
    expect(categories(found)).toEqual(["retry"]);
    expect(found[0]?.evidenceSeq).toBe(2);
  });

  it("a dead click that is retried yields one dead_click and one retry, not two dead clicks", () => {
    const events = [1, 2].map((seq) => step("impatient", seq, { targetLabel: "Add to cart", domChanged: false }));
    expect(found(events)).toEqual(["dead_click@1", "retry@2"]);
  });

  it("does not fire for repeated scrolls, waits or key presses, nor for different labels", () => {
    expect(detectFriction([1, 2].map((seq) => step("cautious", seq, { actionType: "scroll", targetLabel: "" })))).toEqual([]);
    expect(detectFriction([1, 2].map((seq) => step("keyboard", seq, { actionType: "press", targetLabel: "Search", signals: { keysPressed: ["Tab"], focusMoved: true } })))).toEqual([]);
    expect(detectFriction([step("cautious", 1, { targetLabel: "A" }), step("cautious", 2, { targetLabel: "B" })])).toEqual([]);
  });

  it("does not fire when another action happened in between", () => {
    const events = [step("cautious", 1, { targetLabel: "Add to cart" }), step("cautious", 2, { targetLabel: "Size M" }), step("cautious", 3, { targetLabel: "Add to cart" })];
    expect(detectFriction(events)).toEqual([]);
  });
});

describe("loop", () => {
  const visit = (seq: number, path: string): StepEvent => step("cautious", seq, { url: `https://shop.example${path}` });

  it("fires on the third visit to a URL, not on three steps within one visit", () => {
    expect(detectFriction([visit(1, "/list"), visit(2, "/list"), visit(3, "/list")])).toEqual([]);
    const events = [visit(1, "/list"), visit(2, "/a"), visit(3, "/list"), visit(4, "/b"), visit(5, "/list")];
    const result = detectFriction(events);
    expect(categories(result)).toEqual(["loop"]);
    expect(result[0]?.evidenceSeq).toBe(5);
  });

  it("fires once per URL even if the looping continues, and ignores trailing slashes and hashes", () => {
    const events = [visit(1, "/list"), visit(2, "/a"), visit(3, "/list/"), visit(4, "/b"), visit(5, "/list#grid"), visit(6, "/c"), visit(7, "/list")];
    expect(categories(detectFriction(events))).toEqual(["loop"]);
  });
});

describe("step_budget", () => {
  const many = (n: number): StepEvent[] => Array.from({ length: n }, (_, i) => step("cautious", i + 1));

  it(`fires on step ${STEP_BUDGET + 1}, once`, () => {
    expect(detectFriction(many(STEP_BUDGET))).toEqual([]);
    const result = detectFriction(many(STEP_BUDGET + 3));
    expect(categories(result)).toEqual(["step_budget"]);
    expect(result[0]?.evidenceSeq).toBe(STEP_BUDGET + 1);
  });

  it("does not fire if the task already succeeded before the 13th step", () => {
    // 12 steps (seq 1-12), then the outcome at seq 13, then a 13th step at seq 14.
    const thirteenth = step("cautious", STEP_BUDGET + 2);
    const outcome = (result: "success" | "failure"): RunEvent => ({
      runId: "t",
      personaId: "cautious",
      seq: STEP_BUDGET + 1,
      ts: thirteenth.ts - 500,
      type: "done",
      payload: { outcome: result, totalSteps: STEP_BUDGET, frictionCount: 0, durationMs: 1 },
    });
    // Control: the 13th step does trip the budget when the task was NOT a success.
    expect(found([...many(STEP_BUDGET), outcome("failure"), thirteenth])).toEqual([`step_budget@${STEP_BUDGET + 2}`]);
    expect(found([...many(STEP_BUDGET), outcome("success"), thirteenth])).toEqual([]);
  });
});

describe("error_text", () => {
  it("fires when new error text appears and stays quiet while it merely persists", () => {
    const error = "Please select a size.";
    const events = [step("cautious", 1), step("cautious", 2, { signals: { errorTexts: [error] } }), step("cautious", 3, { signals: { errorTexts: [error] } })];
    const result = detectFriction(events);
    expect(categories(result)).toEqual(["error_text"]);
    expect(result[0]?.evidenceSeq).toBe(2);
    expect(result[0]?.summary).toContain(error);
  });

  it("fires again for a different error", () => {
    const events = [step("cautious", 1, { signals: { errorTexts: ["A is required"] } }), step("cautious", 2, { signals: { errorTexts: ["A is required", "B is invalid"] } })];
    expect(found(events)).toEqual(["error_text@1", "error_text@2"]);
  });
});

describe("modal_interrupt", () => {
  it("fires when an overlay appeared", () => {
    const result = detectFriction([step("cautious", 1, { actionType: "scroll", signals: { modalAppeared: true, modalLabel: "Subscribe" } })]);
    expect(categories(result)).toEqual(["modal_interrupt"]);
    expect(result[0]?.summary).toContain("Subscribe");
  });
});

describe("long_wait", () => {
  it(`fires only above ${LONG_WAIT_MS}ms, and escalates past double`, () => {
    expect(detectFriction([step("impatient", 1, { durationMs: LONG_WAIT_MS })])).toEqual([]);
    const slow = detectFriction([step("impatient", 1, { durationMs: LONG_WAIT_MS + 1 })]);
    expect(categories(slow)).toEqual(["long_wait"]);
    expect(slow[0]?.heuristic.severity).toBe(3);
    expect(detectFriction([step("impatient", 1, { durationMs: 12_000 })])[0]?.heuristic.severity).toBe(4);
  });
});

describe("keyboard_trap", () => {
  const press = (personaId: PersonaId, keys: string[], focusMoved: boolean): StepEvent =>
    step(personaId, 1, { actionType: "press", targetLabel: "Colour", domChanged: false, signals: { keysPressed: keys, focusMoved, focusLabel: "Colour" } });

  it("fires for the keyboard persona when Tab (or Shift+Tab) leaves focus where it was", () => {
    expect(categories(detectFriction([press("keyboard", ["Tab"], false)]))).toEqual(["keyboard_trap"]);
    expect(categories(detectFriction([press("keyboard", ["Shift+Tab"], false)]))).toEqual(["keyboard_trap"]);
  });

  it("does not fire when focus moved, when the key was not Tab, or for a pointer persona", () => {
    expect(detectFriction([press("keyboard", ["Tab"], true)])).toEqual([]);
    expect(detectFriction([press("keyboard", ["Enter"], false)])).toEqual([]);
    expect(detectFriction([press("impatient", ["Tab"], false)])).toEqual([]);
  });
});

describe("ambiguous_label", () => {
  it("fires once per accessible name", () => {
    const events = [1, 2].map((seq) => step("keyboard", seq, { actionType: "press", targetLabel: "Select options", signals: { sameLabelCount: 4, keysPressed: ["Enter"], focusMoved: true } }));
    const result = detectFriction(events);
    expect(categories(result)).toEqual(["ambiguous_label"]);
    expect(result[0]?.evidenceSeq).toBe(1);
  });

  it("needs at least two controls with the name, and a name", () => {
    expect(detectFriction([step("keyboard", 1, { signals: { sameLabelCount: 1 } })])).toEqual([]);
    expect(detectFriction([step("keyboard", 1, { targetLabel: "", domChanged: true, signals: { sameLabelCount: 5 } })])).toEqual([]);
  });
});

describe("personas are judged independently", () => {
  it("one persona's steps never create another persona's retry", () => {
    const events = [step("impatient", 1, { targetLabel: "Go" }), step("cautious", 1, { targetLabel: "Go" })];
    expect(detectFriction(events)).toEqual([]);
  });
});

/* ----------------------------------------------------------- findErrorTexts */

describe("findErrorTexts", () => {
  it("matches live regions loosely and ordinary text strictly", () => {
    expect(findErrorTexts([{ role: "alert", name: "Sorry, we couldn't add that." }])).toEqual(["Sorry, we couldn't add that."]);
    expect(findErrorTexts([{ role: "text", name: "Sorry we missed you! Here's 10% off." }])).toEqual([]);
    expect(findErrorTexts([{ role: "text", name: "Size M is out of stock." }])).toEqual(["Size M is out of stock."]);
    expect(findErrorTexts([{ role: "textbox", name: "Email", invalid: true }])).toEqual(["Email"]);
  });

  it("de-duplicates, ignores noise and respects the limit", () => {
    const nodes = [
      { role: "alert", name: "Error: card declined" },
      { role: "status", name: "error: card declined" },
      { role: "alert", name: "ok" },
      { role: "alert", name: "Please enter a postcode" },
    ];
    expect(findErrorTexts(nodes)).toEqual(["Error: card declined", "Please enter a postcode"]);
    expect(findErrorTexts(nodes, 1)).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- judgement */

describe("judgeCandidate", () => {
  const candidate = detectFriction(golden.events).find((c) => c.category === "dead_click") as FrictionCandidate;
  const context: JudgeContext = {
    task: golden.run.task,
    persona: PERSONA_BY_ID.impatient,
    recentSteps: golden.events.filter((e): e is StepEvent => e.type === "step" && e.personaId === "impatient"),
  };

  it("uses the model's judgement when it is valid", async () => {
    const finding = await judgeCandidate(candidate, context, async () => ({ category: "dead_click", severity: 5, whyItMatters: "w", recommendation: "r", confidence: 0.91 }));
    expect(finding).toMatchObject({ judgedBy: "model", severity: 5, confidence: 0.91, recommendation: "r" });
  });

  it("never lets the model change the category, and clamps confidence", async () => {
    const finding = await judgeCandidate(candidate, context, async () => ({ category: "loop", severity: 2, whyItMatters: "w", recommendation: "r", confidence: 7 }));
    expect(finding.category).toBe("dead_click");
    expect(finding.confidence).toBe(1);
  });

  it("falls back to the heuristic on junk, on a throw, and when there is no model", async () => {
    const junk = await judgeCandidate(candidate, context, async () => ({ severity: 9 }));
    const thrown = await judgeCandidate(candidate, context, async () => {
      throw new Error("429");
    });
    const none = await judgeCandidate(candidate, context);
    for (const finding of [junk, thrown, none]) {
      expect(finding.judgedBy).toBe("heuristic");
      expect(finding.severity).toBe(candidate.heuristic.severity);
      expect(finding.recommendation.length).toBeGreaterThan(20);
    }
  });

  it("builds a prompt that carries the facts and marks the evidence step", () => {
    const request = buildJudgeRequest(candidate, context);
    expect(request.input).toContain(golden.run.task);
    expect(request.input).toContain("dead_click");
    expect(request.input).toContain("<-- evidence");
    expect(request.instructions).toContain("do not change the category");
    expect(request.schema.required).toEqual(["category", "severity", "whyItMatters", "recommendation", "confidence"]);
    expect(request.schema.additionalProperties).toBe(false);
  });

  it("turns a judged candidate into a valid friction payload", async () => {
    const payload = toFrictionPayload(candidate, await judgeCandidate(candidate, context));
    expect(payload).toMatchObject({ category: "dead_click", evidenceSeq: candidate.evidenceSeq, judgedBy: "heuristic" });
    expect(payload.summary).toBe(candidate.summary);
  });
});

describe("persona definitions", () => {
  it("only the impatient persona abandons after two failed attempts", () => {
    expect(PERSONAS.map((p) => p.maxFailedAttempts)).toEqual([2, 4, 4]);
  });
});

function found(events: RunEvent[]): string[] {
  return detectFriction(events).map((c) => tag(c.category, c.evidenceSeq));
}
