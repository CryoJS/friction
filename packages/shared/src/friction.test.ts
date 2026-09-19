/**
 * Friction detector unit tests. Everything here runs offline: the detectors
 * are pure, and the fixture is the oracle.
 *
 *   pnpm test
 */
import { describe, expect, it } from "vitest";
import {
  AGENT,
  RunSnapshotSchema,
  buildReportFromSnapshot,
  findingsFromEvents,
  type FrictionEvent,
  type Lane,
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
  tallyFindings,
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
function step(lane: Lane, seq: number, overrides: Partial<StepPayload> = {}): StepEvent {
  clock += 1000;
  return {
    runId: "t",
    lane,
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
const p1 = (seq: number, overrides: Partial<StepPayload> = {}): StepEvent => step("primary", seq, overrides);
const categories = (found: FrictionCandidate[]): string[] => found.map((c) => c.category);

/* ------------------------------------------------------------- the fixture */

describe("golden fixture", () => {
  const primary = golden.events.filter((e) => e.lane === "primary");

  it("is a valid RunSnapshot", () => {
    expect(RunSnapshotSchema.safeParse(raw).success).toBe(true);
  });

  it("has one primary lane: 12-18 steps, one unhappy ending, and a run row that agrees with it", () => {
    const steps = primary.filter((e) => e.type === "step").length;
    expect(steps).toBeGreaterThanOrEqual(12);
    expect(steps).toBeLessThanOrEqual(18);
    const done = primary.filter((e) => e.type === "done");
    expect(done).toHaveLength(1);
    expect(done[0]?.type === "done" && done[0].payload.outcome).toBe("failure");
    expect(golden.run.outcome).toBe("failure");
    expect(golden.run.totalSteps).toBe(steps);
  });

  it("is ordered by timestamp", () => {
    const ts = golden.events.map((e) => e.ts);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it("verifies the top two findings: one verified and mapped, one honestly rejected, never a pull request", () => {
    const fixes = golden.events.filter((e) => e.type === "fix");
    const last = new Map(fixes.map((e) => [e.type === "fix" ? e.payload.findingId : "", e.type === "fix" ? e.payload : null]));
    expect([...last.keys()]).toEqual(["f13", "f15"]);
    expect(last.get("f13")).toMatchObject({ stage: "verified", sourceFile: "src/components/ProductForm.tsx", after: { outcome: "success" } });
    expect(last.get("f15")).toMatchObject({ stage: "rejected", sourceFile: null, after: { outcome: "timeout" } });
    expect(fixes.every((e) => e.type === "fix" && e.payload.prUrl === null)).toBe(true);
  });

  it("keeps every verify run in the verify lane, stamped with its fix, with seqs that never collide", () => {
    const verify = golden.events.filter((e) => e.lane === "verify");
    expect(verify.every((e) => e.fixId === "f13" || e.fixId === "f15")).toBe(true);
    expect(new Set(verify.map((e) => e.seq)).size).toBe(verify.length);
    const dones = verify.filter((e) => e.type === "done");
    expect(dones.map((e) => e.fixId)).toEqual(["f13", "f15"]);
  });

  it("repeats a finding under one id with a growing hitCount, evidenced by its first hit", () => {
    const deadClicks = primary.filter((e): e is FrictionEvent => e.type === "friction" && e.payload.category === "dead_click");
    expect(deadClicks.map((e) => e.payload.hitCount)).toEqual([1, 2]);
    expect(new Set(deadClicks.map((e) => e.payload.findingId)).size).toBe(1);
    expect(new Set(deadClicks.map((e) => e.payload.evidenceSeq)).size).toBe(1);
    expect(deadClicks[1]?.payload.lastSeq).toBeGreaterThan(deadClicks[0]?.payload.evidenceSeq ?? Infinity);
  });
});

describe("detectFriction against the golden fixture", () => {
  const recorded = golden.events.filter((e): e is FrictionEvent => e.type === "friction");
  const hitTag = (e: FrictionEvent): string => `${e.lane}:${tag(e.payload.category, e.payload.lastSeq ?? e.payload.evidenceSeq)}`;
  const candidateTag = (c: FrictionCandidate): string => `${c.lane}:${tag(c.category, c.evidenceSeq)}`;

  it("finds exactly the occurrences recorded", () => {
    expect(detectFriction(golden.events).map(candidateTag).sort()).toEqual(recorded.map(hitTag).sort());
  });

  it("computes the same findingKey the fixture recorded for every occurrence", () => {
    const byTag = new Map(recorded.map((e) => [hitTag(e), e.payload.findingKey]));
    for (const candidate of detectFriction(golden.events)) expect(candidate.findingKey).toBe(byTag.get(candidateTag(candidate)));
  });

  it("writes the same summaries the fixture recorded for first hits", () => {
    const bySummary = new Map(recorded.filter((e) => e.payload.hitCount === 1).map((e) => [hitTag(e), e.payload.summary]));
    for (const candidate of detectFriction(golden.events)) {
      const summary = bySummary.get(candidateTag(candidate));
      if (summary !== undefined) expect(candidate.summary).toBe(summary);
    }
  });

  it("tallies occurrences into the fixture's deduplicated findings, with matching hit counts", () => {
    const tallies = tallyFindings(detectFriction(golden.events).filter((c) => c.lane === "primary"));
    const fromEvents = findingsFromEvents(golden.events);
    expect(tallies.map((t) => `${t.findingKey}x${t.hits.length}`).sort()).toEqual(fromEvents.map((f) => `${f.findingKey}x${f.hitCount}`).sort());
    expect(fromEvents.find((f) => f.category === "dead_click")?.hitCount).toBe(2);
  });

  it("is order-independent: shuffled input gives the same result", () => {
    expect(detectFriction([...golden.events].reverse())).toEqual(detectFriction(golden.events));
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

  it("works incrementally: every occurrence appears as soon as its evidence step exists, exactly once", () => {
    const emitted = new Set<string>();
    golden.events.forEach((_, index) => {
      const prefix = golden.events.slice(0, index + 1);
      for (const candidate of newCandidates(prefix, emitted)) {
        emitted.add(candidate.key);
        const evidenceIndex = prefix.findIndex((e) => e.lane === candidate.lane && e.seq === candidate.evidenceSeq);
        // Detected on the very event that evidences it: that is what makes it "real time".
        expect(evidenceIndex, candidate.key).toBe(index);
      }
    });
    expect(emitted.size).toBe(recorded.length);
    expect(detectFriction(golden.events).map((c) => c.key).sort()).toEqual([...emitted].sort());
  });
});

describe("the report built from the fixture", () => {
  const report = buildReportFromSnapshot(golden, 0);
  const ids = new Set(golden.events.flatMap((e) => (e.type === "friction" && e.lane === "primary" ? [e.payload.findingId] : [])));

  it("lists each deduplicated primary finding once, ranked, with its first-hit evidence joined", () => {
    expect(report.findings).toHaveLength(ids.size);
    expect(report.findings[0]?.category).toBe("dead_click");
    expect(report.findings[0]?.hitCount).toBe(2);
    expect(report.findings.every((f) => f.evidence !== null && f.evidence.seq === f.evidenceSeq)).toBe(true);
    expect(report.primary.outcome).toBe("failure");
  });
});

/* ------------------------------------------------------- detector by detector */

describe("dead_click", () => {
  it("fires when a click changes neither the URL nor the DOM", () => {
    const found = detectFriction([p1(1), p1(2, { targetLabel: "Buy", domChanged: false })]);
    expect(categories(found)).toEqual(["dead_click"]);
    expect(found[0]?.evidenceSeq).toBe(2);
  });

  it("does not fire when the DOM changed, the URL changed, or the action is not a click", () => {
    expect(detectFriction([p1(1, { domChanged: true })])).toEqual([]);
    expect(detectFriction([p1(1, { domChanged: false, signals: { urlAfter: "https://shop.example/next" } })])).toEqual([]);
    expect(detectFriction([p1(1, { actionType: "scroll", domChanged: false })])).toEqual([]);
  });

  it("infers the URL change from the next step when urlAfter is missing", () => {
    expect(categories(detectFriction([p1(1, { domChanged: false }), p1(2, { url: "https://shop.example/other" })]))).toEqual([]);
  });

  it("ignores a hash-only URL change (same page)", () => {
    expect(categories(detectFriction([p1(1, { domChanged: false, signals: { urlAfter: "https://shop.example/#top" } })]))).toEqual(["dead_click"]);
  });

  it("does not blame the site when the action itself could not be executed", () => {
    expect(detectFriction([p1(1, { domChanged: false, signals: { actionFailed: true } })])).toEqual([]);
  });
});

describe("retry", () => {
  it("fires on the second identical actionType + targetLabel, once per streak", () => {
    const found = detectFriction([1, 2, 3].map((seq) => p1(seq, { targetLabel: "Add to cart" })));
    expect(categories(found)).toEqual(["retry"]);
    expect(found[0]?.evidenceSeq).toBe(2);
  });

  it("a dead click that is retried yields one dead_click and one retry, not two dead clicks", () => {
    expect(found([1, 2].map((seq) => p1(seq, { targetLabel: "Add to cart", domChanged: false })))).toEqual(["dead_click@1", "retry@2"]);
  });

  it("does not fire for repeated scrolls, waits or key presses, nor for different labels", () => {
    expect(detectFriction([1, 2].map((seq) => p1(seq, { actionType: "scroll", targetLabel: "" })))).toEqual([]);
    expect(detectFriction([1, 2].map((seq) => p1(seq, { actionType: "press", targetLabel: "Search", signals: { keysPressed: ["Tab"], focusMoved: true } })))).toEqual([]);
    expect(detectFriction([p1(1, { targetLabel: "A" }), p1(2, { targetLabel: "B" })])).toEqual([]);
  });

  it("does not fire when another action happened in between", () => {
    expect(detectFriction([p1(1, { targetLabel: "Add to cart" }), p1(2, { targetLabel: "Size M" }), p1(3, { targetLabel: "Add to cart" })])).toEqual([]);
  });
});

describe("loop", () => {
  const visit = (seq: number, path: string): StepEvent => p1(seq, { url: `https://shop.example${path}` });

  it("fires on the third visit to a URL, not on three steps within one visit", () => {
    expect(detectFriction([visit(1, "/list"), visit(2, "/list"), visit(3, "/list")])).toEqual([]);
    const result = detectFriction([visit(1, "/list"), visit(2, "/a"), visit(3, "/list"), visit(4, "/b"), visit(5, "/list")]);
    expect(categories(result)).toEqual(["loop"]);
    expect(result[0]?.evidenceSeq).toBe(5);
  });

  it("fires once per URL even if the looping continues, and ignores trailing slashes and hashes", () => {
    const events = [visit(1, "/list"), visit(2, "/a"), visit(3, "/list/"), visit(4, "/b"), visit(5, "/list#grid"), visit(6, "/c"), visit(7, "/list")];
    expect(categories(detectFriction(events))).toEqual(["loop"]);
  });
});

describe("step_budget", () => {
  const many = (n: number): StepEvent[] => Array.from({ length: n }, (_, i) => p1(i + 1));

  it(`fires on step ${STEP_BUDGET + 1}, once`, () => {
    expect(detectFriction(many(STEP_BUDGET))).toEqual([]);
    const result = detectFriction(many(STEP_BUDGET + 3));
    expect(categories(result)).toEqual(["step_budget"]);
    expect(result[0]?.evidenceSeq).toBe(STEP_BUDGET + 1);
  });

  it("does not fire if the task already succeeded before the 13th step", () => {
    const thirteenth = p1(STEP_BUDGET + 2);
    const outcome = (result: "success" | "failure"): RunEvent => ({
      runId: "t",
      lane: "primary",
      seq: STEP_BUDGET + 1,
      ts: thirteenth.ts - 500,
      type: "done",
      payload: { outcome: result, totalSteps: STEP_BUDGET, frictionCount: 0, durationMs: 1 },
    });
    expect(found([...many(STEP_BUDGET), outcome("failure"), thirteenth])).toEqual([`step_budget@${STEP_BUDGET + 2}`]);
    expect(found([...many(STEP_BUDGET), outcome("success"), thirteenth])).toEqual([]);
  });
});

describe("error_text", () => {
  it("fires when new error text appears and stays quiet while it merely persists", () => {
    const error = "Please select a size.";
    const result = detectFriction([p1(1), p1(2, { signals: { errorTexts: [error] } }), p1(3, { signals: { errorTexts: [error] } })]);
    expect(categories(result)).toEqual(["error_text"]);
    expect(result[0]?.evidenceSeq).toBe(2);
    expect(result[0]?.summary).toContain(error);
  });

  it("fires again for a different error", () => {
    expect(found([p1(1, { signals: { errorTexts: ["A is required"] } }), p1(2, { signals: { errorTexts: ["A is required", "B is invalid"] } })])).toEqual([
      "error_text@1",
      "error_text@2",
    ]);
  });
});

describe("modal_interrupt", () => {
  it("fires when an overlay appeared", () => {
    const result = detectFriction([p1(1, { actionType: "scroll", signals: { modalAppeared: true, modalLabel: "Subscribe" } })]);
    expect(categories(result)).toEqual(["modal_interrupt"]);
    expect(result[0]?.summary).toContain("Subscribe");
    expect(result[0]?.findingKey).toBe("modal_interrupt:modal:subscribe");
  });
});

describe("long_wait", () => {
  it(`fires only above ${LONG_WAIT_MS}ms, and escalates past double`, () => {
    expect(detectFriction([p1(1, { durationMs: LONG_WAIT_MS })])).toEqual([]);
    const slow = detectFriction([p1(1, { durationMs: LONG_WAIT_MS + 1 })]);
    expect(categories(slow)).toEqual(["long_wait"]);
    expect(slow[0]?.heuristic.severity).toBe(3);
    expect(detectFriction([p1(1, { durationMs: 12_000 })])[0]?.heuristic.severity).toBe(4);
  });
});

describe("keyboard_trap", () => {
  const press = (keys: string[], focusMoved: boolean): StepEvent =>
    p1(1, { actionType: "press", targetLabel: "Colour", domChanged: false, signals: { keysPressed: keys, focusMoved, focusLabel: "Colour" } });

  it("fires when the agent chose to press Tab (or Shift+Tab) and focus stayed where it was", () => {
    expect(categories(detectFriction([press(["Tab"], false)]))).toEqual(["keyboard_trap"]);
    expect(categories(detectFriction([press(["Shift+Tab"], false)]))).toEqual(["keyboard_trap"]);
  });

  it("does not fire when focus moved, or when the key was not Tab", () => {
    expect(detectFriction([press(["Tab"], true)])).toEqual([]);
    expect(detectFriction([press(["Enter"], false)])).toEqual([]);
  });

  it("only fires for an actual press action: keyboard behaviour is never inferred", () => {
    const typed = p1(1, { actionType: "type", signals: { keysPressed: ["Tab"], focusMoved: false } });
    const clicked = p1(1, { actionType: "click", signals: { keysPressed: ["Tab"], focusMoved: false } });
    expect(categories(detectFriction([typed]))).not.toContain("keyboard_trap");
    expect(categories(detectFriction([clicked]))).not.toContain("keyboard_trap");
  });
});

describe("ambiguous_label", () => {
  it("fires once per accessible name", () => {
    const events = [1, 2].map((seq) => p1(seq, { actionType: "press", targetLabel: "Select options", signals: { sameLabelCount: 4, keysPressed: ["Enter"], focusMoved: true } }));
    const result = detectFriction(events);
    expect(categories(result)).toEqual(["ambiguous_label"]);
    expect(result[0]?.evidenceSeq).toBe(1);
  });

  it("needs at least two controls with the name, and a name", () => {
    expect(detectFriction([p1(1, { signals: { sameLabelCount: 1 } })])).toEqual([]);
    expect(detectFriction([p1(1, { targetLabel: "", domChanged: true, signals: { sameLabelCount: 5 } })])).toEqual([]);
  });
});

describe("lanes are judged independently", () => {
  it("the primary lane's steps never create a verify-lane retry", () => {
    expect(detectFriction([step("primary", 1, { targetLabel: "Go" }), step("verify", 1, { targetLabel: "Go" })])).toEqual([]);
  });
});

describe("dedupe by category + selector", () => {
  const dead = (seq: number): StepEvent => p1(seq, { targetLabel: "Add to cart", selector: "#add", domChanged: false });

  it("counts non-consecutive dead clicks on one selector as one finding hit several times", () => {
    const tallies = tallyFindings(detectFriction([dead(1), p1(2, { targetLabel: "Colour" }), dead(3), p1(4, { targetLabel: "Size" }), dead(5)]));
    expect(tallies).toHaveLength(1);
    expect(tallies[0]?.findingKey).toBe("dead_click:#add");
    expect(tallies[0]?.hits.map((h) => h.evidenceSeq)).toEqual([1, 3, 5]);
  });

  it("keeps different selectors, and different categories on one selector, apart", () => {
    const events = [dead(1), dead(2), p1(3, { targetLabel: "Wishlist", selector: "#wish", domChanged: false })];
    expect(tallyFindings(detectFriction(events)).map((t) => t.findingKey)).toEqual(["dead_click:#add", "retry:#add", "dead_click:#wish"]);
  });

  it("falls back to the label, then the page, when there is no selector", () => {
    const events = [p1(1, { targetLabel: "Buy", selector: "", domChanged: false }), p1(2, { targetLabel: "", selector: "", domChanged: false })];
    expect(tallyFindings(detectFriction(events)).map((t) => t.findingKey)).toEqual(["dead_click:label:buy", "dead_click:page:https://shop.example/"]);
  });

  it("a repeat payload keeps the first hit as evidence and carries the count", async () => {
    const [tally] = tallyFindings(detectFriction([dead(1), p1(2), dead(3)]));
    if (!tally) throw new Error("no tally");
    const judged = await judgeCandidate(tally.first, { task: "t", recentSteps: [] });
    const repeat = toFrictionPayload(tally.first, judged, { hit: tally.hits[1] as FrictionCandidate, hitCount: 2 });
    expect(repeat).toMatchObject({ evidenceSeq: 1, lastSeq: 3, hitCount: 2, findingKey: "dead_click:#add", selector: "#add" });
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
    // What the emitter has at detection time: the steps up to the evidence.
    recentSteps: golden.events.filter((e): e is StepEvent => e.type === "step" && e.lane === "primary" && e.seq <= candidate.evidenceSeq),
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
    expect(payload).toMatchObject({ category: "dead_click", evidenceSeq: candidate.evidenceSeq, judgedBy: "heuristic", hitCount: 1, findingKey: candidate.findingKey });
    expect(payload.summary).toBe(candidate.summary);
  });
});

describe("the agent", () => {
  it("is one neutral first-time visitor, with no persona role-play", () => {
    expect(AGENT.maxFailedAttempts).toBe(4);
    expect(AGENT.systemPrompt).toMatch(/first time/);
    expect(AGENT.systemPrompt).not.toMatch(/impatient|cautious|keyboard-only/i);
  });
});

function found(events: RunEvent[]): string[] {
  return detectFriction(events).map((c) => tag(c.category, c.evidenceSeq));
}
