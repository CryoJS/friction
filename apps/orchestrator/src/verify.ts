/**
 * VERIFICATION: does the proposed fix actually remove the friction?
 *
 *   1. report stage "verifying" (before = the primary run)
 *   2. open a BRAND-NEW browser session in a fresh context (openBrowser makes a
 *      new Browserbase context per call; the primary session is never reused,
 *      so cookies and storage start clean)
 *   3. page.addInitScript(patch) BEFORE the first navigation, so the fix is in
 *      place from first paint. Never page.evaluate(): that would run after the
 *      page loaded, the agent would meet the broken page first, and the
 *      verification would prove nothing. evaluate() is used only to READ back
 *      a marker proving the init script ran.
 *   4. re-run the identical agent loop (same task, same step cap), every event
 *      in lane "verify" stamped with this fix's id
 *   5. compare with the primary run (shared/fixes.ts judgeVerification)
 *   6. report "verified" or "rejected", before/after populated
 *   7. the session closes when the loop ends
 *
 * The injection is session-local and ephemeral: it changes the DOM inside
 * Friction's own disposable browser, never the user's site, server or repo.
 */
import {
  evidenceKey,
  guardPatch,
  judgeVerification,
  normalizeUrlForVisit,
  type LaneResult,
  type RunEvent,
  type StructuredCaller,
  type Verdict,
} from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { runAgent, type AgentResult } from "./agentRunner";
import type { Config } from "./config";
import { LaneEmitter } from "./emitter";
import type { FindingForFix } from "./fixer";
import type { FixReport } from "./fixReport";
import { runMockAgent } from "./mockRunner";
import type { Planner } from "./planner";
import { errorMessage, log, withTimeout } from "./util";
import type { WorkerClient } from "./workerClient";

export interface VerifyArgs {
  runId: string;
  url: string;
  task: string;
  config: Config;
  worker: WorkerClient;
  /** The fix, already reported as "proposed". */
  report: FixReport;
  finding: FindingForFix;
  /** The primary run's result: the "before". */
  before: LaneResult;
  /** Verify lane seqs must start above this (the lane may already hold another fix's run). */
  seqFloor: number;
  /** Live mode: the planner. Null in mock mode, which replays the fixture's verify runs. */
  planner: Planner | null;
  judge?: StructuredCaller;
}

export interface VerifyOutcome {
  verdict: Verdict;
  after: LaneResult;
  /** The last seq this verification used in the verify lane. */
  lastSeq: number;
}

/** Mock mode: the fixture's recorded verify run for a fix of the same category. */
function recordedVerifyRun(category: string): RunEvent[] {
  const events = getGoldenRun().events;
  const fix = events.find((e) => e.type === "fix" && e.payload.category === category);
  if (!fix?.fixId) return [];
  return events.filter((e) => e.lane === "verify" && e.fixId === fix.fixId && e.type !== "fix");
}

export async function verifyFix(args: VerifyArgs): Promise<VerifyOutcome> {
  const { runId, config, worker, report, finding, before } = args;

  await report.update({ stage: "verifying", before, after: null, note: "Re-running the task with the fix applied." });
  const emitter = new LaneEmitter(worker, runId, "verify", args.task, args.judge, Math.max(report.lastSeq, args.seqFloor), finding.findingId);
  emitter.status("idle", "Opening a fresh browser session with the fix installed.");

  let patchActive = false;
  let session: { liveViewUrl: string | null; replayUrl: string | null } = { liveViewUrl: null, replayUrl: null };
  let result: AgentResult;

  if (!args.planner) {
    const script = recordedVerifyRun(finding.category);
    patchActive = script.length > 0;
    result = await runMockAgent({ runId, script, config, worker, emitter, onSession: async () => undefined });
  } else {
    const injected = guardPatch(report.state.patchJs, finding.findingId);
    result = await runAgent({
      runId,
      url: args.url,
      task: args.task,
      config,
      worker,
      planner: args.planner,
      emitter,
      evidenceKeyFor: () => evidenceKey(runId, "verify", emitter.lastSeq + 1),
      onSession: async (browser) => {
        session = { liveViewUrl: browser.liveViewUrl, replayUrl: browser.replayUrl };
      },
      // The fix goes in before the page exists: from first paint, on every document this session loads.
      beforeFirstNavigation: async (page) => {
        await withTimeout(page.addInitScript(injected), 15_000, "addInitScript");
      },
      // Read-only proof that the init script ran on the start page.
      afterFirstNavigation: async (page) => {
        try {
          const marker = await withTimeout(page.evaluate<string | null>("window.__frictionFix ?? null"), 8000, "patch marker");
          patchActive = marker === finding.findingId;
        } catch (err) {
          log("verify", `${finding.findingId}: could not read the patch marker: ${errorMessage(err)}`);
        }
      },
    });
  }

  const after: LaneResult = { outcome: result.outcome, steps: result.steps, durationMs: result.durationMs };
  const categoryHits = emitter.findings.filter((f) => f.first.category === finding.category).reduce((n, f) => n + f.hitCount, 0);
  const findingPage = normalizeUrlForVisit(finding.url);
  const reachedFindingPage = emitter.events.some(
    (e) => e.type === "step" && (normalizeUrlForVisit(e.payload.url) === findingPage || normalizeUrlForVisit(e.payload.signals?.urlAfter ?? "") === findingPage),
  );
  const verdict = judgeVerification({ category: finding.category, before, after: { result: after, errored: result.errored, patchActive, categoryHits, reachedFindingPage } });

  await report.update({ stage: verdict.stage, before, after, note: verdict.note, liveViewUrl: session.liveViewUrl, replayUrl: session.replayUrl });
  log("verify", `${finding.findingId} ${verdict.stage}: ${verdict.note}`);
  return { verdict, after, lastSeq: Math.max(report.lastSeq, emitter.lastSeq) };
}
