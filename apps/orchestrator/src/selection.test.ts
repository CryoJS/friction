import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planVerification, type FixRecord, type FrictionCategory, type RunSnapshot, type Verdict } from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { recordedCandidates, scheduleVerifications, unfixedFindings } from "./selection";

const golden = getGoldenRun();
const snapshot: RunSnapshot = { run: golden.run, events: golden.events, source: "fixture" };
const fixRow = (findingId: string): FixRecord => ({ id: `r:${findingId}`, runId: "r", findingId, stage: "rejected", summary: "", patchJs: "", sourceFile: null, newFileContent: null, sourceSha: null, before: null, after: null, prUrl: null, createdAt: 1, updatedAt: 1 });

describe("the verification plan, re-derived from a recorded run", () => {
  const candidates = recordedCandidates(snapshot);

  it("reads every primary finding once, with its final hit count", () => {
    assert.deepEqual(candidates.map((c) => c.findingId).sort(), ["f11", "f13", "f15", "f21", "f8"]);
    assert.equal(candidates.find((c) => c.findingId === "f13")?.hitCount, 2);
  });

  it("the golden run: the dead Add to cart is the cause; the retry and the step budget on the same button are not verified separately", () => {
    const plan = planVerification(candidates, 3);
    assert.deepEqual(plan.selected.map((c) => `${c.findingId} ${c.category}`), ["f13 dead_click", "f8 modal_interrupt", "f11 long_wait"]);
    assert.deepEqual(plan.notSelected.map((n) => [n.finding.findingId, n.why, n.sameCauseAs]), [
      ["f15", "same_cause", "f13"],
      ["f21", "same_cause", "f13"],
    ]);
  });

  it("explains every finding that has no fix row, and none that has one", () => {
    const unfixed = unfixedFindings(planVerification(candidates, 1), [fixRow("f13")]);
    assert.deepEqual(unfixed.map((u) => u.findingId).sort(), ["f11", "f15", "f21", "f8"]);
    assert.match(unfixed.find((u) => u.findingId === "f15")?.reason ?? "", /same element as f13/);
    assert.match(unfixed.find((u) => u.findingId === "f8")?.reason ?? "", /below the cut/);
    assert.match(unfixed.find((u) => u.findingId === "f11")?.reason ?? "", /long_wait is a symptom/);
    assert.deepEqual(unfixedFindings(planVerification(candidates, 1), []).map((u) => u.findingId)[0], "f13");
  });
});

describe("scheduleVerifications", () => {
  type F = { findingId: string; category: FrictionCategory };
  const still: Verdict = { stage: "rejected", reason: "still_fires", note: "dead_click still fires (2 times); the agent gave up after 7 steps, down from 14 steps and giving up." };
  const ok: Verdict = { stage: "verified", reason: "no_longer_fires", note: "" };
  const f = (findingId: string, category: FrictionCategory = "dead_click"): F => ({ findingId, category });

  /** Every first attempt gets `first`; every retry gets `second`. The log is the order things ran in. */
  const harness = (first: (finding: F) => Verdict | null, second: Verdict = ok) => {
    const calls: string[] = [];
    const attempt = async (finding: F, retryOf?: { id: string }) => {
      calls.push(retryOf ? `retry ${finding.findingId} onto ${retryOf.id}` : `first ${finding.findingId}`);
      const verdict = retryOf ? second : first(finding);
      return verdict ? { ran: true, outcome: { report: retryOf ?? { id: `row-${finding.findingId}` }, verdict } } : { ran: false, outcome: null };
    };
    return { calls, attempt };
  };

  it("retries a rejected fix once, onto the same fix row, after every first attempt", async () => {
    const { calls, attempt } = harness((finding) => (finding.findingId === "f10" ? still : ok));
    const result = await scheduleVerifications({ selected: [f("f10"), f("f6"), f("f18", "step_budget")], maxRuns: 4, skip: () => false, attempt });
    assert.deepEqual(calls, ["first f10", "first f6", "first f18", "retry f10 onto row-f10"]);
    assert.deepEqual(result, { used: 4, retried: ["f10"] });
  });

  it("a retry never exceeds the cap, and a retry that is rejected again is not retried", async () => {
    const { calls, attempt } = harness(() => still, still);
    const result = await scheduleVerifications({ selected: [f("a"), f("b"), f("c")], maxRuns: 4, skip: () => false, attempt });
    assert.deepEqual(calls, ["first a", "first b", "first c", "retry a onto row-a"]);
    assert.equal(result.used, 4);

    const roomy = harness(() => still, still);
    assert.equal((await scheduleVerifications({ selected: [f("a"), f("b")], maxRuns: 10, skip: () => false, attempt: roomy.attempt })).used, 4);
    assert.equal(roomy.calls.filter((call) => call.startsWith("retry")).length, 2);
  });

  it("first attempts stop at the cap too, and a cap below VERIFY_TOP_N leaves no retry", async () => {
    const { calls, attempt } = harness(() => still);
    const result = await scheduleVerifications({ selected: [f("a"), f("b"), f("c")], maxRuns: 2, skip: () => false, attempt });
    assert.deepEqual(calls, ["first a", "first b"]);
    assert.deepEqual(result, { used: 2, retried: [] });
  });

  it("a finding with no acceptable patch spends no run, and a skipped finding none either", async () => {
    const { calls, attempt } = harness((finding) => (finding.findingId === "a" ? null : ok));
    const result = await scheduleVerifications({ selected: [f("a"), f("b"), f("c")], maxRuns: 4, skip: (finding) => finding.findingId === "c", attempt });
    assert.deepEqual(calls, ["first a", "first b"]);
    assert.equal(result.used, 1);
  });

  it("never retries a symptom", async () => {
    const { calls, attempt } = harness(() => ({ ...still, note: "loop still fires (2 times)" }));
    await scheduleVerifications({ selected: [f("f20", "loop")], maxRuns: 4, skip: () => false, attempt });
    assert.deepEqual(calls, ["first f20"]);
  });
});
