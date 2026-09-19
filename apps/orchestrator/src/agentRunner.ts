/**
 * One agent run, start to finish:
 *   session -> report it -> observe / plan / act / capture loop -> done.
 *
 * The same loop drives both lanes. The primary lane runs it as is; the verify
 * lane runs it in a fresh session with a fix installed (see verify.ts), which
 * is the only difference between the two.
 *
 * Never throws. Whatever goes wrong (session crash, model outage, a site that
 * hangs) ends as a `failed` status plus a `done` event for this lane.
 */
import { AGENT, stateForOutcome, type Outcome } from "@friction/shared";
import { performStep } from "./actor";
import { openBrowser, type BrowserHandle, type StagehandPage } from "./browser";
import type { Config } from "./config";
import type { LaneEmitter } from "./emitter";
import { observe } from "./observe";
import type { HistoryEntry, PlannedAction, Planner } from "./planner";
import { errorMessage, log, withTimeout } from "./util";
import type { WorkerClient } from "./workerClient";

export interface AgentRun {
  runId: string;
  url: string;
  task: string;
  /** From a scan's generated task: the planner judges taskComplete against it. */
  successCheck?: string;
  config: Config;
  worker: WorkerClient;
  planner: Planner;
  /** Created by the caller, which has already emitted this lane's idle status. */
  emitter: LaneEmitter;
  /** R2 key for a step's evidence screenshot. */
  evidenceKeyFor: (stepNumber: number) => string;
  /** Where the session's live view / replay URLs go once it is up. */
  onSession: (browser: BrowserHandle) => Promise<void>;
  /** Runs once the page exists and BEFORE the first navigation. */
  beforeFirstNavigation?: (page: StagehandPage) => Promise<void>;
  /** Runs right after the first navigation (the start URL) has loaded. */
  afterFirstNavigation?: (page: StagehandPage) => Promise<void>;
  /** Runs once every finding is final, just before the done event (the run's lifecycle may depend on it). */
  beforeDone?: () => Promise<void>;
  /** Tests inject a browser; production opens one. */
  openBrowser?: () => Promise<BrowserHandle>;
}

export interface AgentResult {
  outcome: Outcome;
  steps: number;
  durationMs: number;
  summary: string;
  /** The pruned accessibility tree seen before each step, by the step event's seq. */
  trees: ReadonlyMap<number, readonly string[]>;
  /** The run itself broke (no session, crash), as opposed to the agent failing the task. */
  errored: boolean;
}

export async function runAgent(run: AgentRun): Promise<AgentResult> {
  const { config, emitter } = run;
  const lane = emitter.lane;
  const startedAt = Date.now();
  const history: HistoryEntry[] = [];
  const trees = new Map<number, readonly string[]>();
  let browser: BrowserHandle | null = null;
  let outcome: Outcome = "failure";
  let summary = "";
  let failedAttempts = 0;
  let errored = false;

  const outOfTime = (): boolean => Date.now() - startedAt > config.agentTimeoutMs;

  try {
    browser = await withTimeout((run.openBrowser ?? (() => openBrowser(config, lane)))(), 120_000, "browser session");
    await run.onSession(browser);
    await run.beforeFirstNavigation?.(browser.page);
    emitter.status("running", "Session is up.", { liveViewUrl: browser.liveViewUrl, replayUrl: browser.replayUrl });
    log(lane, `session ${browser.sessionId ?? "(local)"} up in ${Date.now() - startedAt}ms`);
    const session = browser;

    const act = async (plan: PlannedAction): Promise<void> => {
      const stepNumber = emitter.stepCount + 1;
      const observation = await observe(session.page);
      const result = await performStep({ browser: session, worker: run.worker, runId: run.runId, evidenceKeyFor: run.evidenceKeyFor, startUrl: run.url, stepNumber }, plan, observation);
      const event = emitter.step(result.payload);
      trees.set(event.seq, result.treeLines);
      history.push({ step: stepNumber, action: result.historyAction, outcome: result.historyOutcome });
      if (result.failedAttempt) failedAttempts += 1;
      log(lane, `step ${stepNumber}: ${result.historyAction} -> ${result.historyOutcome}`);
    };

    // Step 1 is always the navigation to the start URL. Not planned: there is nothing to look at yet.
    await act({ actionType: "navigate", targetDescription: "", value: run.url, rationale: "I'm opening the site.", taskComplete: false });
    await run.afterFirstNavigation?.(session.page);

    let decided = false;
    while (!decided && emitter.stepCount < config.maxSteps) {
      if (outOfTime()) {
        outcome = "timeout";
        summary = `Ran out of time after ${emitter.stepCount} steps.`;
        decided = true;
        break;
      }
      if (failedAttempts >= AGENT.maxFailedAttempts) {
        outcome = "failure";
        summary = `Abandoned after ${failedAttempts} failed attempts: ${history[history.length - 1]?.action ?? "the last action"} got nowhere.`;
        decided = true;
        break;
      }

      const observation = await observe(session.page);
      const plan = await run.planner.plan({ task: run.task, successCheck: run.successCheck, startUrl: run.url, step: emitter.stepCount + 1, maxSteps: config.maxSteps, observation, history });
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
      if (failedAttempts >= AGENT.maxFailedAttempts) {
        summary = `Abandoned after ${failedAttempts} failed attempts.`;
      } else {
        const observation = await observe(session.page);
        const verdict = await run.planner
          .plan({ task: run.task, successCheck: run.successCheck, startUrl: run.url, step: emitter.stepCount, maxSteps: config.maxSteps, observation, history, finalCheck: true })
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
    errored = true;
    // Session crash, model outage, a site that hangs: whatever it was, this lane stops here.
    summary = `${browser ? "Stopped by an error" : "Could not start a browser session"}: ${errorMessage(err)}`;
    log(lane, summary);
  }

  const durationMs = Date.now() - startedAt;
  try {
    await emitter.settle();
    await run.beforeDone?.().catch((err: unknown) => log(lane, `beforeDone failed: ${errorMessage(err)}`));
    emitter.status(stateForOutcome(outcome), summary);
    emitter.done({ outcome, durationMs, summary });
    await emitter.flush();
  } finally {
    await browser?.close().catch(() => undefined);
  }
  log(lane, `done: ${outcome} in ${emitter.stepCount} steps, ${emitter.frictionCount} findings. ${summary}`);
  return { outcome, steps: emitter.stepCount, durationMs, summary, trees, errored };
}
