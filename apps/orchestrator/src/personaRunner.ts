/**
 * One persona, start to finish:
 *   session -> PATCH live view -> observe / plan / act / capture loop -> done.
 *
 * Never throws. Whatever goes wrong (session crash, model outage, a site that
 * hangs) ends as a `failed` status plus a `done` event for THIS persona, and
 * the other two carry on.
 */
import { stateForOutcome, type Outcome, type PersonaDefinition } from "@friction/shared";
import { performStep } from "./actor";
import { openBrowser, type BrowserHandle } from "./browser";
import type { Config } from "./config";
import type { PersonaEmitter } from "./emitter";
import { observe } from "./observe";
import type { HistoryEntry, PlannedAction, Planner } from "./planner";
import { errorMessage, log, withTimeout } from "./util";
import type { WorkerClient } from "./workerClient";

export interface PersonaRun {
  runId: string;
  url: string;
  task: string;
  /** From a scan's generated task; the planner judges taskComplete against it. */
  successCheck?: string;
  persona: PersonaDefinition;
  config: Config;
  worker: WorkerClient;
  planner: Planner;
  /** Created by the run manager, which has already emitted this persona's idle status. */
  emitter: PersonaEmitter;
  /** Tests inject a browser; production opens one. */
  openBrowser?: () => Promise<BrowserHandle>;
}

const OPENING_LINES: Record<string, string> = {
  impatient: "Open the site. Let's get this over with.",
  cautious: "I'll open the site and take a moment to see how it's organised.",
  keyboard: "Loading the site; I'll start tabbing from the top of the page.",
};

export async function runPersona(run: PersonaRun): Promise<Outcome> {
  const { persona, config, worker, emitter } = run;
  const startedAt = Date.now();
  const history: HistoryEntry[] = [];
  let browser: BrowserHandle | null = null;
  let outcome: Outcome = "failure";
  let summary = "";
  let failedAttempts = 0;

  const outOfTime = (): boolean => Date.now() - startedAt > config.personaTimeoutMs;

  try {
    browser = await withTimeout((run.openBrowser ?? (() => openBrowser(config, persona.id)))(), 120_000, "browser session");
    await worker.patchPersona(run.runId, {
      personaId: persona.id,
      liveViewUrl: browser.liveViewUrl,
      sessionId: browser.sessionId,
      replayUrl: browser.replayUrl,
    });
    emitter.status("running", "Session is up.");
    log(persona.id, `session ${browser.sessionId ?? "(local)"} up in ${Date.now() - startedAt}ms`);
    const session = browser;

    const act = async (plan: PlannedAction): Promise<void> => {
      const stepNumber = emitter.stepCount + 1;
      const observation = await observe(session.page);
      const result = await performStep({ browser: session, worker, runId: run.runId, persona, startUrl: run.url, stepNumber }, plan, observation);
      emitter.step(result.payload);
      history.push({ step: stepNumber, action: result.historyAction, outcome: result.historyOutcome });
      if (result.failedAttempt) failedAttempts += 1;
      log(persona.id, `step ${stepNumber}: ${result.historyAction} -> ${result.historyOutcome}`);
    };

    // Step 1 is always the navigation to the start URL. Not planned: there is nothing to look at yet.
    await act({ actionType: "navigate", targetDescription: "", value: run.url, rationale: OPENING_LINES[persona.id] ?? "Open the site.", taskComplete: false });

    let decided = false;
    while (!decided && emitter.stepCount < config.maxSteps) {
      if (outOfTime()) {
        outcome = "timeout";
        summary = `Ran out of time after ${emitter.stepCount} steps.`;
        decided = true;
        break;
      }
      if (failedAttempts >= persona.maxFailedAttempts) {
        outcome = "failure";
        summary = `Abandoned after ${failedAttempts} failed attempts: ${history[history.length - 1]?.action ?? "the last action"} got nowhere.`;
        decided = true;
        break;
      }

      const observation = await observe(session.page);
      const plan = await run.planner.plan({ persona, task: run.task, successCheck: run.successCheck, startUrl: run.url, step: emitter.stepCount + 1, maxSteps: config.maxSteps, observation, history });
      if (plan.taskComplete) {
        outcome = "success";
        summary = plan.rationale || "Task complete.";
        decided = true;
        break;
      }
      await act(plan);
    }

    // Used every step without declaring victory: one last look, so a run that
    // finished on its final action is not reported as a timeout.
    if (!decided) {
      if (failedAttempts >= persona.maxFailedAttempts) {
        summary = `Abandoned after ${failedAttempts} failed attempts.`;
      } else {
        const observation = await observe(session.page);
        const verdict = await run.planner
          .plan({ persona, task: run.task, successCheck: run.successCheck, startUrl: run.url, step: emitter.stepCount, maxSteps: config.maxSteps, observation, history, finalCheck: true })
          .catch(() => null);
        if (verdict?.taskComplete) {
          outcome = "success";
          summary = verdict.rationale || "Task complete on the last allowed step.";
        } else {
          outcome = "timeout";
          summary = `Hit the ${config.maxSteps}-step cap without completing the task.`;
        }
      }
    }
  } catch (err) {
    outcome = "failure";
    // Session crash, model outage, a site that hangs: whatever it was, this persona stops here.
    summary = `${browser ? "Stopped by an error" : "Could not start a browser session"}: ${errorMessage(err)}`;
    log(persona.id, summary);
  }

  try {
    await emitter.settle();
    emitter.status(stateForOutcome(outcome), summary);
    emitter.done({ outcome, durationMs: Date.now() - startedAt, summary });
    await emitter.flush();
  } finally {
    await browser?.close().catch(() => undefined);
  }
  log(persona.id, `done: ${outcome} in ${emitter.stepCount} steps, ${emitter.frictionCount} findings. ${summary}`);
  return outcome;
}
