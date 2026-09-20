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
 *
 * FRICTION_EXTENSION_INJECT=1 swaps step 3 for the other route: the patch is
 * packaged as a Chrome MV3 extension (extension.ts) and installed into the
 * session when it is created, which puts it in the page's MAIN world at
 * document_start. Anything that goes wrong with that — the flag off, a local
 * browser, a failed or slow upload — falls back to addInitScript, so this mode
 * can never cost a verification run.
 */
import {
  evidenceKey,
  guardPatch,
  hitsOfFinding,
  judgeVerification,
  normalizeUrlForVisit,
  type FrictionCategory,
  type LaneResult,
  type RunEvent,
  type StepEvent,
  type StructuredCaller,
  type Verdict,
} from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { runAgent, type AgentResult } from "./agentRunner";
import { openBrowser } from "./browser";
import type { Config } from "./config";
import { LaneEmitter } from "./emitter";
import { buildAndUploadPatchExtension } from "./extension";
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
  /** The primary run's success check, if it had one, so both runs are judged alike. */
  successCheck?: string;
  config: Config;
  worker: WorkerClient;
  /** The fix, already reported as "proposed". */
  report: FixReport;
  finding: FindingForFix;
  /** The primary run's result: the "before". */
  before: LaneResult;
  /** Hits of this finding's problem in the primary run (hitsOfFinding), for "it fired less than it did". */
  categoryHitsBefore?: number;
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
  /** Every category that fired in the verify run: a symptom absent from it can be credited to a verified fix. */
  firedCategories: ReadonlySet<FrictionCategory>;
  /** What the agent did with the fix installed: a retry's proposer is shown where it went wrong. */
  steps: StepEvent[];
}

/** Mock mode: the fixture's recorded verify run for a fix of the same category. */
function recordedVerifyRun(category: string): RunEvent[] {
  const events = getGoldenRun().events;
  const fix = events.find((e) => e.type === "fix" && e.payload.category === category);
  if (!fix?.fixId) return [];
  return events.filter((e) => e.lane === "verify" && e.fixId === fix.fixId && e.type !== "fix");
}

/** Mock mode can only verify what the fixture recorded a verify run for. */
export function hasRecordedVerifyRun(category: string): boolean {
  return recordedVerifyRun(category).length > 0;
}

/**
 * FRICTION_EXTENSION_INJECT=1 only: the patch packaged as an uploaded Chrome
 * extension, to be installed at session-create time. Null for every reason
 * there could be (flag off, local browser, upload failed, upload too slow) —
 * the caller then takes the addInitScript path, unchanged. This must never
 * break a verification run.
 */
async function patchExtensionId(config: Config, patchJs: string, url: string): Promise<string | null> {
  if (!config.extensionInject || config.mode === "mock" || config.browserEnv === "LOCAL") return null;
  try {
    return await withTimeout(buildAndUploadPatchExtension(patchJs, new URL(url).origin), 10_000, "patch extension upload");
  } catch (err) {
    log("verify", `extension injection unavailable, falling back to addInitScript: ${errorMessage(err)}`);
    return null;
  }
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
    const extensionId = await patchExtensionId(config, injected, args.url);
    result = await runAgent({
      runId,
      url: args.url,
      task: args.task,
      successCheck: args.successCheck,
      config,
      worker,
      planner: args.planner,
      emitter,
      evidenceKeyFor: () => evidenceKey(runId, "verify", emitter.lastSeq + 1),
      onSession: async (browser) => {
        session = { liveViewUrl: browser.liveViewUrl, replayUrl: browser.replayUrl };
      },
      // Extension mode: the session itself carries the patch, so there is nothing to inject.
      ...(extensionId ? { openBrowser: () => openBrowser(config, "verify", { extensionId }) } : {}),
      // The fix goes in before the page exists: from first paint, on every document this session loads.
      beforeFirstNavigation: extensionId
        ? undefined
        : async (page) => {
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
  const steps = emitter.events.filter((e): e is StepEvent => e.type === "step");
  // Only this finding's own element counts against its fix: the page's other dead buttons are other findings.
  const categoryHits = hitsOfFinding(
    finding,
    emitter.findings.map((f) => ({ category: f.first.category, selector: f.first.selector, targetLabel: steps.find((s) => s.seq === f.first.evidenceSeq)?.payload.targetLabel ?? "", hitCount: f.hitCount })),
  );
  const findingPage = normalizeUrlForVisit(finding.url);
  const reachedFindingPage = emitter.events.some(
    (e) => e.type === "step" && (normalizeUrlForVisit(e.payload.url) === findingPage || normalizeUrlForVisit(e.payload.signals?.urlAfter ?? "") === findingPage),
  );
  const verdict = judgeVerification({
    category: finding.category,
    before,
    after: { result: after, errored: result.errored, patchActive, categoryHits, reachedFindingPage },
    categoryHitsBefore: args.categoryHitsBefore,
    target: finding.targetLabel || undefined,
  });

  await report.update({ stage: verdict.stage, before, after, note: verdict.note, liveViewUrl: session.liveViewUrl, replayUrl: session.replayUrl });
  log("verify", `${finding.findingId} ${verdict.stage}: ${verdict.note}`);
  return { verdict, after, lastSeq: Math.max(report.lastSeq, emitter.lastSeq), firedCategories: new Set(emitter.findings.map((f) => f.first.category)), steps };
}
