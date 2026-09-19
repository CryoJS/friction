/**
 * The site-wide report: findings from many runs merged into ranked issues.
 *
 *   pnpm test
 */
import { describe, expect, it } from "vitest";
import {
  PERSONA_IDS,
  assembleScanReport,
  findingsFromEvents,
  isStepEvent,
  issueKey,
  type FrictionCategory,
  type PersonaId,
  type PersonaState,
  type ScanFindingInput,
  type ScanRecord,
  type ScanTreeTask,
  type Severity,
  type StepEvent,
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

function treeTask(index: number, states: PersonaState[]): ScanTreeTask {
  return {
    index,
    runId: `r${index}`,
    title: `Task ${index + 1}`,
    whyCritical: "It matters.",
    successCheck: "It shows.",
    personas: PERSONA_IDS.map((personaId, i) => ({ personaId, state: states[i] ?? "idle", stepCount: 0, findingCount: 0, worstSeverity: null })),
  };
}

function step(runId: string, personaId: PersonaId, seq: number, url: string, targetLabel: string): StepEvent {
  return {
    runId,
    personaId,
    seq,
    ts: 1_800_000_000_000 + seq,
    type: "step",
    payload: {
      url,
      actionType: "click",
      targetLabel,
      selector: "#x",
      rationale: "because",
      screenshotKey: `runs/${runId}/${personaId}/${seq}.jpg`,
      bbox: null,
      durationMs: 100,
      domChanged: false,
    },
  };
}

let nextId = 0;
function finding(runId: string, personaId: PersonaId, category: FrictionCategory, severity: Severity, confidence: number, evidenceSeq: number): ScanFindingInput {
  nextId += 1;
  return {
    id: String(nextId),
    runId,
    personaId,
    category,
    severity,
    confidence,
    evidenceSeq,
    recommendation: `Fix ${category} ${nextId}`,
    summary: `Saw ${category} ${nextId}`,
    whyItMatters: null,
  };
}

describe("assembleScanReport", () => {
  const tree = { scan: SCAN, tasks: [treeTask(0, ["succeeded", "failed", "running"]), treeTask(1, ["succeeded", "succeeded", "succeeded"])] };
  const evidence = [
    step("r0", "impatient", 5, "https://s.example/Cart/", "Checkout"),
    step("r0", "cautious", 7, "https://s.example/cart?x=1", " checkout "),
    step("r0", "cautious", 9, "https://s.example/cart", "Checkout"),
    step("r1", "keyboard", 3, "https://s.example/cart", "Checkout"),
    step("r1", "keyboard", 4, "https://s.example/", "Cookie consent"),
  ];
  const findings = [
    finding("r0", "impatient", "dead_click", 3, 0.8, 5), // 1
    finding("r0", "cautious", "dead_click", 4, 0.6, 7), // 2
    finding("r0", "cautious", "dead_click", 2, 0.95, 9), // 3: same run and persona again
    finding("r1", "keyboard", "dead_click", 4, 0.9, 3), // 4: the representative
    finding("r1", "keyboard", "modal_interrupt", 5, 0.7, 4), // 5
    finding("r0", "impatient", "loop", 4, 0.5, 99), // 6: evidence step never arrived
    finding("r_other", "impatient", "retry", 5, 1, 1), // 7: not part of this scan
  ];
  const report = assembleScanReport({ tree, findings, evidence, now: 42 });
  const deadClick = report.issues.find((issue) => issue.category === "dead_click");

  it("merges the same element on the same page across tasks and personas", () => {
    expect(deadClick?.key).toBe("dead_click|/cart|checkout");
    expect(deadClick?.occurrences).toHaveLength(4);
    expect(deadClick?.runsHit).toBe(3);
    expect(deadClick?.totalRuns).toBe(6);
    expect(deadClick?.personas).toEqual(["impatient", "cautious", "keyboard"]);
    expect(deadClick?.taskIndexes).toEqual([0, 1]);
  });

  it("orders occurrences by task, then persona, then seq", () => {
    expect(deadClick?.occurrences.map((o) => `${o.taskIndex}.${o.personaId}.${o.evidenceSeq}`)).toEqual([
      "0.impatient.5",
      "0.cautious.7",
      "0.cautious.9",
      "1.keyboard.3",
    ]);
  });

  it("takes the worst severity and best confidence, and the representative's words and evidence", () => {
    expect(deadClick?.severity).toBe(4);
    expect(deadClick?.confidence).toBe(0.95);
    expect(deadClick?.recommendation).toBe("Fix dead_click 4");
    expect(deadClick?.summary).toBe("Saw dead_click 4");
    expect(deadClick?.evidence?.seq).toBe(3);
    expect(deadClick?.page).toBe("/cart");
    expect(deadClick?.targetLabel).toBe("Checkout");
  });

  it("ranks by severity, then reach, then confidence", () => {
    expect(report.issues.map((issue) => issue.category)).toEqual(["modal_interrupt", "dead_click", "loop"]);
  });

  it("keeps an issue whose evidence step never arrived", () => {
    const loop = report.issues.find((issue) => issue.category === "loop");
    expect(loop?.key).toBe("loop||");
    expect(loop?.page).toBe("");
    expect(loop?.evidence).toBeNull();
  });

  it("ignores findings from runs that are not part of the scan", () => {
    expect(report.issues.some((issue) => issue.category === "retry")).toBe(false);
  });

  it("summarizes verdicts, persona success and severities", () => {
    expect(report.scan).toBe(SCAN);
    expect(report.generatedAt).toBe(42);
    expect(report.summary.verdicts).toEqual({ pass: 1, partial: 0, fail: 0, pending: 1 });
    expect(report.summary.personas).toEqual({
      impatient: { succeeded: 2, finished: 2, total: 2 },
      cautious: { succeeded: 1, finished: 2, total: 2 },
      keyboard: { succeeded: 1, finished: 1, total: 2 },
    });
    expect(report.summary.issuesBySeverity).toEqual({ 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
    expect(report.tasks).toEqual([
      { index: 0, runId: "r0", title: "Task 1", verdict: "pending" },
      { index: 1, runId: "r1", title: "Task 2", verdict: "pass" },
    ]);
  });
});

describe("assembleScanReport over ten copies of the golden run", () => {
  const golden = getGoldenRun();
  const tasks = Array.from({ length: 10 }, (_, i) => treeTask(i, ["succeeded", "failed", "timeout"]));
  const goldenFindings = findingsFromEvents(golden.events);
  const goldenSteps = golden.events.filter(isStepEvent);
  const report = assembleScanReport({
    tree: { scan: SCAN, tasks },
    findings: tasks.flatMap((task) => goldenFindings.map((f) => ({ ...f, id: `${task.runId}:${f.id}`, runId: task.runId }))),
    evidence: tasks.flatMap((task) => goldenSteps.map((s) => ({ ...s, runId: task.runId }))),
  });

  const stepOf = new Map(goldenSteps.map((s) => [`${s.personaId}:${s.seq}`, s] as const));
  const perCopy = new Map<string, number>();
  for (const f of goldenFindings) {
    const s = stepOf.get(`${f.personaId}:${f.evidenceSeq}`);
    const key = issueKey(f.category, s?.payload.url ?? null, s?.payload.targetLabel ?? "");
    perCopy.set(key, (perCopy.get(key) ?? 0) + 1);
  }

  it("has one issue per distinct finding in a single copy", () => {
    expect(report.issues).toHaveLength(perCopy.size);
  });

  it("counts every copy", () => {
    for (const issue of report.issues) {
      expect(issue.occurrences).toHaveLength((perCopy.get(issue.key) ?? 0) * 10);
      expect(issue.runsHit % 10).toBe(0);
      expect(issue.taskIndexes).toHaveLength(10);
      expect(issue.totalRuns).toBe(30);
    }
  });

  it("marks every task partial", () => {
    expect(report.summary.verdicts).toEqual({ pass: 0, partial: 10, fail: 0, pending: 0 });
  });
});
