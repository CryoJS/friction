/**
 * A run = one agent attempting one task in the primary lane, then, for the top
 * VERIFY_TOP_N findings, one at a time:
 *
 *   proposeFix -> verifyFix -> (if verified) findSourceFile -> generateSourceFix
 *
 * and then it waits. A pull request is opened only when the user clicks "Open
 * pull request" in the control room (see pr.ts); never automatically.
 */
import { evidenceKey, selectTopFindings, type LaneResult, type StepEvent, type StructuredCaller } from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { runAgent, type AgentResult } from "./agentRunner";
import type { Config } from "./config";
import { LaneEmitter } from "./emitter";
import { findingForFix, openAIFixer, proposeAndReport, type FindingForFix, type FixProposer } from "./fixer";
import type { FixReport } from "./fixReport";
import { openAIJudge } from "./judge";
import { goldenFixer, goldenJudge, runMockAgent } from "./mockRunner";
import { OpenAIPlanner } from "./planner";
import { findSourceFile, generateSourceFix, openAISourceFixer, type SourceFixer } from "./repo";
import { errorMessage, log } from "./util";
import { verifyFix } from "./verify";
import type { WorkerClient } from "./workerClient";

export class RunManager {
  private readonly active = new Set<string>();

  constructor(
    private readonly config: Config,
    private readonly worker: WorkerClient,
  ) {}

  get activeRuns(): number {
    return this.active.size;
  }

  private get mock(): boolean {
    return this.config.mode === "mock";
  }

  private judge(): StructuredCaller {
    return this.mock ? goldenJudge(this.config.mockSpeed) : openAIJudge(this.config);
  }

  /**
   * Creates the run and returns its id immediately; the agent runs in the
   * background. Before returning, the primary lane's `idle` status is already
   * in the Worker. That matters: the Worker's stream treats a run with no
   * events as having no producer and falls back to the fixture, so the
   * producer has to be visibly attached before the UI can possibly connect.
   */
  async start(url: string, task: string): Promise<string> {
    const runId = await this.worker.createRun(url, task);
    const emitter = new LaneEmitter(this.worker, runId, "primary", task, this.judge());
    emitter.status("idle", this.mock ? "Queued (mock mode)." : "Queued. Starting a Browserbase session.");
    await emitter.flush();

    this.active.add(runId);
    void this.run(runId, url, task, emitter).finally(() => this.active.delete(runId));
    return runId;
  }

  private async run(runId: string, url: string, task: string, emitter: LaneEmitter): Promise<void> {
    const willVerify = (): boolean => this.config.verifyTopN > 0 && emitter.findings.length > 0;
    // Mark the run as verifying BEFORE the primary done event, or the Worker would call it complete.
    const beforeDone = async (): Promise<void> => {
      if (willVerify()) await this.worker.patchRun(runId, { status: "verifying" });
    };

    const primary = await this.runPrimary(runId, url, task, emitter, beforeDone);
    if (!willVerify()) return;
    try {
      await this.verifyTopFindings(runId, url, task, emitter, primary);
    } catch (err) {
      log("run", `${runId} verification stopped: ${errorMessage(err)}`);
    } finally {
      // Whatever happened, the run is over: the stream ends and the UI stops waiting.
      await this.worker.patchRun(runId, { status: "completed" });
    }
  }

  private async runPrimary(runId: string, url: string, task: string, emitter: LaneEmitter, beforeDone: () => Promise<void>): Promise<AgentResult> {
    const { config, worker } = this;
    log("run", `${runId} started in ${config.mode} mode: ${task} @ ${url}`);
    try {
      const result = this.mock
        ? await runMockAgent({
            runId,
            script: getGoldenRun().events.filter((e) => e.lane === "primary"),
            config,
            worker,
            emitter,
            onSession: () => worker.patchRun(runId, { sessionId: "mock-primary", liveViewUrl: null, replayUrl: null }),
            beforeDone,
          })
        : await runAgent({
            runId,
            url,
            task,
            config,
            worker,
            planner: new OpenAIPlanner(config),
            emitter,
            evidenceKeyFor: (stepNumber) => evidenceKey(runId, "primary", stepNumber),
            onSession: (browser) => worker.patchRun(runId, { liveViewUrl: browser.liveViewUrl, sessionId: browser.sessionId, replayUrl: browser.replayUrl }),
            beforeDone,
          });
      log("run", `${runId} primary finished: ${result.outcome} in ${result.steps} steps, ${emitter.frictionCount} findings`);
      return result;
    } catch (err) {
      // runAgent handles its own failures; this is the belt to its braces.
      log("run", `${runId} unexpected failure: ${errorMessage(err)}`);
      emitter.status("failed", `Crashed: ${errorMessage(err)}`);
      emitter.done({ outcome: "failure", durationMs: 0, summary: `Crashed: ${errorMessage(err)}` });
      await emitter.flush();
      return { outcome: "failure", steps: emitter.stepCount, durationMs: 0, summary: errorMessage(err), trees: new Map(), errored: true };
    }
  }

  /**
   * The top VERIFY_TOP_N findings, one at a time: each verification is its own
   * browser run, and one at a time keeps the verify lane's seqs in one order.
   * Every stage is reported as it happens; a failure on one finding never
   * stops the next.
   */
  private async verifyTopFindings(runId: string, url: string, task: string, emitter: LaneEmitter, primary: AgentResult): Promise<void> {
    const { config, worker } = this;
    const steps = emitter.events.filter((e): e is StepEvent => e.type === "step");
    const candidates = emitter.findings.flatMap((f) => {
      const finding = f.payload ? findingForFix(f.payload, steps) : null;
      return finding ? [{ finding, findingId: finding.findingId, severity: finding.severity, confidence: f.payload?.confidence ?? 0, hitCount: finding.hitCount }] : [];
    });
    const top = selectTopFindings(candidates, config.verifyTopN);
    log("run", `${runId} verifying the top ${top.length} of ${candidates.length} findings: ${top.map((t) => `${t.findingId} ${t.finding.category}`).join(", ")}`);

    const before: LaneResult = { outcome: primary.outcome, steps: primary.steps, durationMs: primary.durationMs };
    const proposer: FixProposer = this.mock ? goldenFixer(config.mockSpeed) : openAIFixer(config);
    const sourceFixer: SourceFixer | null = config.github && !this.mock ? openAISourceFixer(config) : null;
    let seqFloor = 0;

    for (const { finding } of top) {
      try {
        const report = await proposeAndReport({
          worker,
          runId,
          proposer,
          input: { task, finding, stepEvents: steps, tree: primary.trees.get(finding.evidenceSeq) ?? null },
        });
        if (!report) continue;
        seqFloor = Math.max(seqFloor, report.lastSeq);

        const outcome = await verifyFix({
          runId,
          url,
          task,
          config,
          worker,
          report,
          finding,
          before,
          seqFloor,
          planner: this.mock ? null : new OpenAIPlanner(config),
          judge: this.judge(),
        });
        seqFloor = outcome.lastSeq;

        if (outcome.verdict.stage === "verified") await this.mapToSource(finding, report, sourceFixer);
        seqFloor = Math.max(seqFloor, report.lastSeq);
      } catch (err) {
        log("run", `${runId} ${finding.findingId}: ${errorMessage(err)}`);
      }
    }
  }

  /** Verified: find the source file and generate its new content. Unmapped is a normal ending. */
  private async mapToSource(finding: FindingForFix, report: FixReport, sourceFixer: SourceFixer | null): Promise<void> {
    const github = this.config.github;
    if (!github || !sourceFixer) {
      log("run", `${finding.findingId}: verified; no repository connected, so it stays unmapped`);
      return;
    }
    const sourceFile = await findSourceFile(github, finding);
    if (!sourceFile) return;
    try {
      const newFileContent = await generateSourceFix(sourceFixer, finding, report.state, sourceFile);
      // Held on the fix row until the user clicks "Open pull request".
      await report.update({ sourceFile: sourceFile.path, newFileContent, sourceSha: sourceFile.sha });
    } catch (err) {
      log("run", `${finding.findingId}: mapped to ${sourceFile.path}, but no acceptable new content: ${errorMessage(err)}`);
    }
  }
}
