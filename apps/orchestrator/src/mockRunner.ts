/**
 * Mock mode: no Browserbase, no OpenAI, no keys.
 *
 * Replays a golden-run lane's steps through the REAL pipeline: evidence is
 * uploaded to R2, step events are POSTed to the Worker, and the real detectors
 * (and dedupe) decide when friction fires. Only the two external services are
 * faked: wireframe screenshots stand in for the browser, and the golden run's
 * recorded judgements stand in for the model.
 *
 * This is how the repo runs end to end before any API key exists, and it is
 * the live-looking fallback if the venue network blocks Browserbase.
 */
import { evidenceKey, renderMockScreenshot, stateForOutcome, validatePatch, type RunEvent, type StructuredCaller } from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import type { AgentResult } from "./agentRunner";
import type { Config } from "./config";
import type { LaneEmitter } from "./emitter";
import type { FixProposer } from "./fixer";
import { log, sleep } from "./util";
import type { WorkerClient } from "./workerClient";

const MAX_GAP_MS = 6000;

/** Stands in for OpenAI: answers with the judgement the golden run recorded for that category. */
export function goldenJudge(speed: number): StructuredCaller {
  const recorded = getGoldenRun().events.filter((e) => e.type === "friction");
  return async (request) => {
    await sleep(Math.round(1200 / speed));
    const category = /Detected category: (\w+)/.exec(request.input)?.[1];
    const match = recorded.find((e) => e.type === "friction" && e.payload.category === category);
    if (match?.type !== "friction") throw new Error(`no recorded judgement for ${category}`);
    const { severity, whyItMatters, recommendation, confidence } = match.payload;
    return { category, severity, whyItMatters: whyItMatters ?? "", recommendation, confidence };
  };
}

/**
 * Stands in for the fix proposer: the fix the golden run recorded for that
 * category, or a small generic patch. Mock mode has no browser, so the patch
 * is only ever displayed, never run; it still has to pass validation.
 */
export function goldenFixer(speed: number): FixProposer {
  const recorded = getGoldenRun().events.flatMap((e) => (e.type === "fix" && e.payload.stage === "proposed" ? [e.payload] : []));
  return async ({ finding }) => {
    await sleep(Math.round(1500 / speed));
    const match = recorded.find((fix) => fix.category === finding.category);
    if (match) return { summary: match.summary, patchJs: match.patchJs };
    const patchJs = [
      "// Mock patch: marks the element this finding is about.",
      "try {",
      "  document.addEventListener(\"DOMContentLoaded\", function () {",
      "    try {",
      `      var target = document.querySelector(${JSON.stringify(finding.targetLabel ? `[aria-label=${JSON.stringify(finding.targetLabel)}]` : "body")});`,
      "      if (target) target.setAttribute(\"data-friction-fix\", \"mock\");",
      "    } catch (e) {}",
      "  });",
      "} catch (e) {}",
    ].join("\n");
    if (validatePatch(patchJs)) throw new Error("mock patch failed validation");
    return { summary: `Marks the element behind the ${finding.category} finding (mock mode: no model was asked).`, patchJs };
  };
}

/**
 * Replays `script` (one lane's recorded events, in order). The session is
 * reported through `onSession`, exactly where a real session would be.
 */
export async function runMockAgent(args: {
  runId: string;
  script: readonly RunEvent[];
  config: Config;
  worker: WorkerClient;
  emitter: LaneEmitter;
  onSession: () => Promise<void>;
  beforeDone?: () => Promise<void>;
}): Promise<AgentResult> {
  const { config, worker, emitter, runId, script } = args;
  const startedAt = Date.now();
  let previousTs = script[0]?.ts ?? 0;
  // Mock mode has no browser, so there is no accessibility tree to hand a fix proposal.
  const trees = new Map<number, readonly string[]>();
  let result: AgentResult = { outcome: "failure", steps: 0, durationMs: 0, summary: "The recording has no ending.", trees, html: new Map(), errored: true };

  for (const event of script) {
    await sleep(Math.min(MAX_GAP_MS, Math.max(0, event.ts - previousTs)) / config.mockSpeed);
    previousTs = event.ts;

    if (event.type === "status" && event.payload.state === "running") {
      await args.onSession();
      emitter.status("running", "Mock session is up (no API keys: replaying the golden run through the real pipeline).");
    } else if (event.type === "step") {
      const stepNumber = emitter.stepCount + 1;
      const key = evidenceKey(runId, emitter.lane, emitter.lastSeq + 1, "svg");
      const uploaded = await worker.putEvidence(key, new TextEncoder().encode(renderMockScreenshot(event.payload)), "image/svg+xml");
      // emitter.step() runs the real detectors; friction comes out of them, not out of the fixture.
      emitter.step({ ...event.payload, screenshotKey: uploaded ? key : "" });
      log(emitter.lane, `mock step ${stepNumber}: ${event.payload.actionType} ${event.payload.targetLabel}`);
    } else if (event.type === "done") {
      const { outcome, summary = "" } = event.payload;
      await emitter.settle();
      await args.beforeDone?.();
      const closing = [...script].reverse().find((e) => e.type === "status" && e.payload.state !== "running" && e.payload.state !== "idle");
      emitter.status(stateForOutcome(outcome), closing?.type === "status" ? closing.payload.message : undefined);
      const durationMs = Date.now() - startedAt;
      emitter.done({ outcome, durationMs, summary });
      result = { outcome, steps: emitter.stepCount, durationMs, summary, trees, html: new Map(), errored: false };
    }
    // Recorded friction and the closing status are skipped: both are regenerated above.
  }

  await emitter.flush();
  log(emitter.lane, `mock done: ${result.outcome}, ${emitter.stepCount} steps, ${emitter.frictionCount} findings`);
  return result;
}
