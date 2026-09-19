/**
 * The fix-verification contracts: the fix event, the upsert body, and how the
 * verify lane is kept apart from the primary lane and from itself.
 */
import { describe, expect, it } from "vitest";
import {
  FixUpsertSchema,
  RunEventSchema,
  StepPayloadSchema,
  FrictionPayloadSchema,
  detectFriction,
  findingsFromEvents,
  isVerdictStage,
  type FixPayload,
  type RunEvent,
  type StepEvent,
} from "./index";

const fix: FixPayload = {
  findingId: "f13",
  stage: "proposed",
  summary: "Tells the visitor to pick a size when Add to cart is pressed without one.",
  patchJs: "try { /* ... */ } catch (e) {}",
  sourceFile: null,
  before: null,
  after: null,
  prUrl: null,
};

let clock = 1_900_000_000_000;
function deadClick(lane: "primary" | "verify", seq: number, fixId?: string): StepEvent {
  clock += 1000;
  return {
    runId: "t",
    lane,
    seq,
    ts: clock,
    ...(fixId ? { fixId } : {}),
    type: "step",
    payload: {
      url: "https://shop.example/p",
      actionType: "click",
      targetLabel: "Add to cart",
      selector: "#add",
      rationale: "r",
      screenshotKey: "",
      bbox: null,
      durationMs: 100,
      domChanged: false,
    },
  };
}

describe("the fix event", () => {
  it("is part of the event union, lives in the verify lane, and carries its fixId", () => {
    const event = { runId: "t", lane: "verify", seq: 4, ts: clock, fixId: "f13", type: "fix", payload: fix };
    const parsed = RunEventSchema.safeParse(event);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.fixId).toBe("f13");
  });

  it("rejects unknown stages and a missing findingId", () => {
    expect(RunEventSchema.safeParse({ runId: "t", lane: "verify", seq: 1, ts: clock, type: "fix", payload: { ...fix, stage: "merged" } }).success).toBe(false);
    expect(RunEventSchema.safeParse({ runId: "t", lane: "verify", seq: 1, ts: clock, type: "fix", payload: { ...fix, findingId: "" } }).success).toBe(false);
  });

  it("accepts before/after results and a PR url once they exist", () => {
    const verified: FixPayload = {
      ...fix,
      stage: "pr_opened",
      sourceFile: "src/components/ProductForm.tsx",
      before: { outcome: "failure", steps: 14, durationMs: 55_000 },
      after: { outcome: "success", steps: 10, durationMs: 41_000 },
      prUrl: "https://github.com/o/r/pull/7",
    };
    expect(RunEventSchema.safeParse({ runId: "t", lane: "verify", seq: 9, ts: clock, fixId: "f13", type: "fix", payload: verified }).success).toBe(true);
  });

  it("knows which stages are verdicts", () => {
    expect(["proposed", "verifying"].map((s) => isVerdictStage(s as FixPayload["stage"]))).toEqual([false, false]);
    expect(["verified", "rejected", "pr_opened"].map((s) => isVerdictStage(s as FixPayload["stage"]))).toEqual([true, true, true]);
  });
});

describe("the fix upsert body", () => {
  it("carries the complete new file content optionally, never a diff field", () => {
    expect(FixUpsertSchema.safeParse(fix).success).toBe(true);
    const withContent = FixUpsertSchema.safeParse({ ...fix, newFileContent: "export const x = 1;\n" });
    expect(withContent.success && withContent.data.newFileContent).toBe("export const x = 1;\n");
    expect("diff" in FixUpsertSchema.shape).toBe(false);
  });
});

describe("the verify lane", () => {
  it("keeps each fix's run apart: dead clicks in two verify runs never combine into a retry", () => {
    const events: RunEvent[] = [deadClick("verify", 1, "f13"), deadClick("verify", 2, "f15")];
    const found = detectFriction(events);
    expect(found.map((c) => `${c.fixId}:${c.category}`).sort()).toEqual(["f13:dead_click", "f15:dead_click"]);
  });

  it("never turns verify-lane friction into report findings", () => {
    const friction: RunEvent = {
      runId: "t",
      lane: "verify",
      seq: 3,
      ts: clock,
      fixId: "f13",
      type: "friction",
      payload: { category: "dead_click", severity: 5, evidenceSeq: 1, recommendation: "r", confidence: 0.9 },
    };
    expect(findingsFromEvents([friction])).toEqual([]);
  });

  it("detectors ignore fix events", () => {
    const events: RunEvent[] = [deadClick("primary", 1), { runId: "t", lane: "verify", seq: 1, ts: clock, fixId: "f1", type: "fix", payload: fix }];
    expect(detectFriction(events).map((c) => c.category)).toEqual(["dead_click"]);
  });
});

describe("anchor on payloads", () => {
  const anchor = {
    xpath: "/html/body/button",
    tag: "button",
    role: "button",
    name: "Add to cart",
    text: "Add to cart",
    attrs: { id: "add-to-cart" },
    ordinal: 0,
    path: "/products/hat",
  };

  const step = {
    url: "https://example.com/products/hat",
    actionType: "click" as const,
    targetLabel: "Add to cart",
    selector: "xpath=/html/body/button",
    rationale: "I'm adding the hat to the cart.",
    screenshotKey: "runs/r_1/primary/3.jpg",
    bbox: null,
    durationMs: 120,
    domChanged: false,
  };

  it("accepts a step payload with an anchor", () => {
    expect(StepPayloadSchema.parse({ ...step, anchor }).anchor).toEqual(anchor);
  });

  it("still accepts a step payload recorded before anchors existed", () => {
    expect(StepPayloadSchema.parse(step).anchor).toBeUndefined();
  });

  it("accepts a friction payload with an anchor, and without", () => {
    const friction = { category: "dead_click" as const, severity: 3 as const, evidenceSeq: 3, recommendation: "Make the button do something.", confidence: 0.9 };
    expect(FrictionPayloadSchema.parse({ ...friction, anchor }).anchor).toEqual(anchor);
    expect(FrictionPayloadSchema.parse(friction).anchor).toBeUndefined();
  });
});
