import { describe, expect, it } from "vitest";
import { parseAnnotationsQuery, toAnnotationFinding } from "./annotations";
import type { StepEvent } from "./events";

describe("parseAnnotationsQuery", () => {
  it("normalizes a host", () => {
    expect(parseAnnotationsQuery({ host: "https://www.Example.com/x" })).toEqual({ ok: true, by: "host", value: "example.com" });
  });

  it("passes a token through untouched", () => {
    expect(parseAnnotationsQuery({ token: "s_abc1234567" })).toEqual({ ok: true, by: "token", value: "s_abc1234567" });
  });

  it("rejects both at once", () => {
    const result = parseAnnotationsQuery({ host: "example.com", token: "s_abc1234567" });
    expect(result.ok).toBe(false);
  });

  it("rejects neither", () => {
    expect(parseAnnotationsQuery({}).ok).toBe(false);
  });

  it("rejects a host that does not normalize", () => {
    expect(parseAnnotationsQuery({ host: "not a host" }).ok).toBe(false);
  });
});

describe("toAnnotationFinding", () => {
  const anchor = { xpath: "/html/body/button", tag: "button", role: "button", name: "Add to cart", text: "Add to cart", attrs: {}, ordinal: 0, path: "/p" };
  const step = {
    runId: "r_1", lane: "primary", seq: 3, ts: 1, type: "step",
    payload: { url: "https://example.com/p", actionType: "click", targetLabel: "Add to cart", selector: "xpath=/html/body/button", rationale: "r", screenshotKey: "runs/r_1/primary/3.jpg", bbox: null, durationMs: 1, domChanged: false, anchor },
  } as StepEvent;
  const finding = {
    id: "f3", findingKey: "dead_click|x", runId: "r_1", category: "dead_click" as const, severity: 3 as const,
    evidenceSeq: 3, recommendation: "Make it do something.", confidence: 0.9, summary: "Nothing happened.",
    whyItMatters: "The visitor cannot buy.", hitCount: 2, selector: "xpath=/html/body/button",
  };

  it("takes the anchor and an absolute evidence URL from the step", () => {
    const result = toAnnotationFinding(finding, step, "https://worker.example/api/evidence");
    expect(result.anchor).toEqual(anchor);
    expect(result.evidenceUrl).toBe("https://worker.example/api/evidence/runs/r_1/primary/3.jpg");
    expect(result.url).toBe("https://example.com/p");
    expect(result.hitCount).toBe(2);
  });

  it("degrades to a null anchor when the step predates anchors", () => {
    const older = { ...step, payload: { ...step.payload, anchor: undefined } } as StepEvent;
    expect(toAnnotationFinding(finding, older, "https://worker.example/api/evidence").anchor).toBeNull();
  });

  it("degrades to a null anchor and empty url when the evidence step is missing entirely", () => {
    const result = toAnnotationFinding(finding, undefined, "https://worker.example/api/evidence");
    expect(result.anchor).toBeNull();
    expect(result.evidenceUrl).toBeNull();
    expect(result.url).toBe("");
  });

  it("uses the page the element was on, not the page the action navigated to", () => {
    const navigated = {
      ...step,
      payload: {
        ...step.payload,
        signals: { urlAfter: "https://example.com/checkout" },
      },
    } as StepEvent;
    const result = toAnnotationFinding(finding, navigated, "https://worker.example/api/evidence");
    expect(result.url).toBe("https://example.com/p");
  });
});
