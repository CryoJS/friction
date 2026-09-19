/**
 * The site-wide report: findings from many runs merged into ranked issues.
 *
 *   pnpm test
 */
import { describe, expect, it } from "vitest";
import {
  assembleScanReport,
  findingsFromEvents,
  isStepEvent,
  issueKey,
  type AgentState,
  type FrictionCategory,
  type ScanFindingInput,
  type ScanRecord,
  type ScanTreeTask,
  type Severity,
  type StepEvent,
  type TaskPullRequest,
} from "./index";
import { getGoldenRun } from "./golden";

const SCAN: ScanRecord = {
  id: "s_1",
  url: "https://s.example/",
  status: "running",
  message: null,
  pages: [],
  taskSource: "model",
  createdAt: 1,
  completedAt: null,
};

function treeTask(index: number, state: AgentState): ScanTreeTask {
  return {
    index,
    runId: `r${index}`,
    title: `Task ${index + 1}`,
    whyCritical: "It matters.",
    successCheck: "It shows.",
    status: state === "idle" ? "pending" : state === "running" ? "running" : "completed",
    state,
    stepCount: 0,
    findingCount: 0,
    worstSeverity: null,
  };
}

function step(runId: string, seq: number, url: string, targetLabel: string, lane: StepEvent["lane"] = "primary"): StepEvent {
  return {
    runId,
    lane,
    seq,
    ts: 1_800_000_000_000 + seq,
    type: "step",
    payload: {
      url,
      actionType: "click",
      targetLabel,
      selector: "#x",
      rationale: "because",
      screenshotKey: `runs/${runId}/${lane}/${seq}.jpg`,
      bbox: null,
      durationMs: 100,
      domChanged: false,
    },
  };
}

let nextId = 0;
function finding(runId: string, category: FrictionCategory, severity: Severity, confidence: number, evidenceSeq: number): ScanFindingInput {
  nextId += 1;
  return {
    id: `f${nextId}`,
    findingKey: `${category}:#x${nextId}`,
    runId,
    category,
    severity,
    confidence,
    evidenceSeq,
    recommendation: `Fix ${category} ${nextId}`,
    summary: `Saw ${category} ${nextId}`,
    whyItMatters: null,
    hitCount: 1,
    selector: "#x",
  };
}

describe("assembleScanReport", () => {
  const tree = { scan: SCAN, tasks: [treeTask(0, "running"), treeTask(1, "succeeded"), treeTask(2, "failed")] };
  const evidence = [
    step("r0", 5, "https://s.example/Cart/", "Checkout"),
    step("r0", 7, "https://s.example/cart?x=1", " checkout "),
    step("r1", 3, "https://s.example/cart", "Checkout"),
    step("r1", 4, "https://s.example/", "Cookie consent"),
    step("r2", 2, "https://s.example/cart", "Checkout"),
    // A verify-lane step sharing a primary seq must never stand in as evidence.
    step("r2", 6, "https://s.example/verify-only", "Elsewhere", "verify"),
  ];
  const findings = [
    finding("r0", "dead_click", 3, 0.8, 5), // f1
    finding("r0", "dead_click", 2, 0.95, 7), // f2: same run again
    finding("r1", "dead_click", 4, 0.9, 3), // f3: the representative
    finding("r1", "modal_interrupt", 5, 0.7, 4), // f4
    finding("r2", "dead_click", 4, 0.6, 2), // f5
    finding("r2", "loop", 4, 0.5, 6), // f6: its primary evidence step never arrived
    finding("r_other", "retry", 5, 1, 1), // f7: not part of this scan
  ];
  const report = assembleScanReport({ tree, findings, evidence, now: 42 });
  const deadClick = report.issues.find((issue) => issue.category === "dead_click");

  it("merges the same element on the same page across tasks", () => {
    expect(deadClick?.key).toBe("dead_click|/cart|checkout");
    expect(deadClick?.occurrences).toHaveLength(4);
    expect(deadClick?.runsHit).toBe(3);
    expect(deadClick?.totalRuns).toBe(3);
    expect(deadClick?.taskIndexes).toEqual([0, 1, 2]);
  });

  it("orders occurrences by task, then seq", () => {
    expect(deadClick?.occurrences.map((o) => `${o.taskIndex}.${o.evidenceSeq}`)).toEqual(["0.5", "0.7", "1.3", "2.2"]);
    expect(deadClick?.occurrences[2]?.findingId).toBe("f3");
  });

  it("takes the worst severity and best confidence, and the representative's words and evidence", () => {
    expect(deadClick?.severity).toBe(4);
    expect(deadClick?.confidence).toBe(0.95);
    expect(deadClick?.recommendation).toBe("Fix dead_click 3");
    expect(deadClick?.summary).toBe("Saw dead_click 3");
    expect(deadClick?.evidence?.seq).toBe(3);
    expect(deadClick?.page).toBe("/cart");
    expect(deadClick?.targetLabel).toBe("Checkout");
  });

  it("ranks by severity, then reach, then confidence", () => {
    expect(report.issues.map((issue) => issue.category)).toEqual(["modal_interrupt", "dead_click", "loop"]);
  });

  it("keeps an issue whose evidence step never arrived, and ignores verify-lane steps", () => {
    const loop = report.issues.find((issue) => issue.category === "loop");
    expect(loop?.key).toBe("loop||");
    expect(loop?.page).toBe("");
    expect(loop?.evidence).toBeNull();
  });

  it("ignores findings from runs that are not part of the scan", () => {
    expect(report.issues.some((issue) => issue.category === "retry")).toBe(false);
  });

  it("summarizes verdicts and severities", () => {
    expect(report.scan).toBe(SCAN);
    expect(report.generatedAt).toBe(42);
    expect(report.summary.verdicts).toEqual({ pass: 1, fail: 1, pending: 1 });
    expect(report.summary.issuesBySeverity).toEqual({ 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
    expect(report.tasks).toEqual([
      { index: 0, runId: "r0", title: "Task 1", verdict: "pending" },
      { index: 1, runId: "r1", title: "Task 2", verdict: "pass" },
      { index: 2, runId: "r2", title: "Task 3", verdict: "fail" },
    ]);
    // A scan with no repository says nothing about pull requests.
    expect(report.summary.pullRequests).toBeUndefined();
  });

  it("carries each task's pull request and the scan total", () => {
    const pr = (index: number, status: TaskPullRequest["status"]): TaskPullRequest => ({ scanId: "s_1", runId: `r${index}`, taskIndex: index, status, findingIds: [], notFixed: [] });
    const pullRequests = [pr(0, "opened"), pr(2, "covered"), { ...pr(9, "opened"), runId: "r_other" }];
    const withPrs = assembleScanReport({ tree, findings, evidence, pullRequests, now: 42 });
    expect(withPrs.tasks.map((task) => task.pullRequest?.status)).toEqual(["opened", undefined, "covered"]);
    expect(withPrs.summary.pullRequests?.text).toBe("1 draft PR opened, 1 task covered.");
    // The tree's own list is the default.
    expect(assembleScanReport({ tree: { ...tree, pullRequests }, findings, evidence }).summary.pullRequests?.counts.opened).toBe(1);
  });
});

describe("assembleScanReport over ten copies of the golden run", () => {
  const golden = getGoldenRun();
  const tasks = Array.from({ length: 10 }, (_, i) => treeTask(i, "failed"));
  const goldenFindings = findingsFromEvents(golden.events);
  const goldenSteps = golden.events.filter(isStepEvent).filter((s) => s.lane === "primary");
  const report = assembleScanReport({
    tree: { scan: SCAN, tasks },
    findings: tasks.flatMap((task) => goldenFindings.map((f) => ({ ...f, runId: task.runId }))),
    evidence: tasks.flatMap((task) => goldenSteps.map((s) => ({ ...s, runId: task.runId }))),
  });

  const stepOf = new Map(goldenSteps.map((s) => [s.seq, s] as const));
  const perCopy = new Map<string, number>();
  for (const f of goldenFindings) {
    const s = stepOf.get(f.evidenceSeq);
    const key = issueKey(f.category, s?.payload.url ?? null, s?.payload.targetLabel ?? "");
    perCopy.set(key, (perCopy.get(key) ?? 0) + 1);
  }

  it("has findings to merge", () => {
    expect(goldenFindings.length).toBeGreaterThan(0);
  });

  it("has one issue per distinct finding in a single copy", () => {
    expect(report.issues).toHaveLength(perCopy.size);
  });

  it("counts every copy", () => {
    for (const issue of report.issues) {
      expect(issue.occurrences).toHaveLength((perCopy.get(issue.key) ?? 0) * 10);
      expect(issue.runsHit).toBe(10);
      expect(issue.taskIndexes).toHaveLength(10);
      expect(issue.totalRuns).toBe(10);
    }
  });

  it("marks every task failed", () => {
    expect(report.summary.verdicts).toEqual({ pass: 0, fail: 10, pending: 0 });
  });
});
