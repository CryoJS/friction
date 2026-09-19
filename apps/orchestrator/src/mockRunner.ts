/**
 * Mock mode: no Browserbase, no OpenAI, no keys.
 *
 * Replays each persona's golden-run steps through the REAL pipeline: evidence
 * is uploaded to R2, step events are POSTed to the Worker, and the real
 * detectors decide when friction fires. Only the two external services are
 * faked: wireframe screenshots stand in for the browser, and the golden run's
 * recorded judgements stand in for the model.
 *
 * This is how the repo runs end to end before any API key exists, and it is
 * the live-looking fallback if the venue network blocks Browserbase.
 */
import { evidenceKey, renderMockScreenshot, type Outcome, type PersonaDefinition, type StructuredCaller } from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import type { Config } from "./config";
import type { PersonaEmitter } from "./emitter";
import { log, sleep } from "./util";
import type { WorkerClient } from "./workerClient";

const MAX_GAP_MS = 6000;

/** Stands in for OpenAI: answers with the judgement the golden run recorded for that category. */
export function goldenJudge(personaId: PersonaDefinition["id"], speed: number): StructuredCaller {
  const recorded = getGoldenRun().events.filter((e) => e.personaId === personaId && e.type === "friction");
  return async (request) => {
    await sleep(Math.round(1200 / speed));
    const category = /Detected category: (\w+)/.exec(request.input)?.[1];
    const match = recorded.find((e) => e.type === "friction" && e.payload.category === category);
    if (match?.type !== "friction") throw new Error(`no recorded judgement for ${category}`);
    const { severity, whyItMatters, recommendation, confidence } = match.payload;
    return { category, severity, whyItMatters: whyItMatters ?? "", recommendation, confidence };
  };
}

export async function runMockPersona(args: {
  runId: string;
  persona: PersonaDefinition;
  config: Config;
  worker: WorkerClient;
  emitter: PersonaEmitter;
}): Promise<Outcome> {
  const { persona, config, worker, emitter, runId } = args;
  const script = getGoldenRun().events.filter((e) => e.personaId === persona.id);
  const startedAt = Date.now();
  let previousTs = script[0]?.ts ?? 0;
  let outcome: Outcome = "failure";

  for (const event of script) {
    await sleep(Math.min(MAX_GAP_MS, Math.max(0, event.ts - previousTs)) / config.mockSpeed);
    previousTs = event.ts;

    if (event.type === "status" && event.payload.state === "running") {
      await worker.patchPersona(runId, { personaId: persona.id, sessionId: `mock-${persona.id}`, liveViewUrl: null, replayUrl: null });
      emitter.status("running", "Mock session is up (no API keys: replaying the golden run through the real pipeline).");
    } else if (event.type === "step") {
      const stepNumber = emitter.stepCount + 1;
      const key = evidenceKey(runId, persona.id, stepNumber, "svg");
      const uploaded = await worker.putEvidence(key, new TextEncoder().encode(renderMockScreenshot(event.payload)), "image/svg+xml");
      // emitter.step() runs the real detectors; friction comes out of them, not out of the fixture.
      emitter.step({ ...event.payload, screenshotKey: uploaded ? key : "" });
    } else if (event.type === "done") {
      outcome = event.payload.outcome;
      await emitter.settle();
      const closing = script.find((e) => e.type === "status" && e.seq > 2);
      emitter.status(outcome === "success" ? "succeeded" : outcome === "timeout" ? "timeout" : "failed", closing?.type === "status" ? closing.payload.message : undefined);
      emitter.done({ outcome, durationMs: Date.now() - startedAt, summary: event.payload.summary });
    }
    // Recorded friction and the closing status are skipped: both are regenerated above.
  }

  await emitter.flush();
  log(persona.id, `mock done: ${outcome}, ${emitter.stepCount} steps, ${emitter.frictionCount} findings`);
  return outcome;
}
