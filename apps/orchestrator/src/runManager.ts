/**
 * A run = one agent attempting one task in the primary lane, then, for the top
 * VERIFY_TOP_N findings, one at a time:
 *
 *   proposeFix -> verifyFix -> (if verified) findSourceFile -> generateSourceFix
 *
 * and then it waits. A pull request is opened when the user clicks "Open pull
 * request" in the control room (see pr.ts), or, for a scan started with
 * automatic pull requests, by the scan once all its runs are over (see
 * scanPullRequests.ts); never by the run itself.
 *
 * create() and execute() are separate so a scan can create all its runs (and
 * post every primary lane's idle status) before any of them starts. Every live
 * browser, primary or verify, waits for a slot in the process-wide session
 * pool; mock runs hold no browser, so they skip it.
 */
import { evidenceKey, selectTopFindings, type LaneResult, type Outcome, type ScanTaskLink, type StepEvent, type StructuredCaller } from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { runAgent, type AgentResult } from "./agentRunner";
import { githubFor, type Config, type GitHubConfig } from "./config";
import { LaneEmitter } from "./emitter";
import { findingForFix, openAIFixer, proposeAndReport, type FindingForFix, type FixProposer } from "./fixer";
import type { FixReport } from "./fixReport";
import { openAIJudge } from "./judge";
import { goldenFixer, goldenJudge, runMockAgent } from "./mockRunner";
import { mockSourceFix } from "./mockSource";
import { OpenAIPlanner } from "./planner";
import { findSourceFile, generateSourceFix, openAISourceFixer, type SourceFixer } from "./repo";
import { errorMessage, log, type Semaphore } from "./util";
import { verifyFix } from "./verify";
import type { WorkerClient } from "./workerClient";

export interface PreparedRun {
  runId: string;
  url: string;
  task: string;
  /** From a scan's generated task: tells the planner what "done" looks like. */
  successCheck?: string;
  /** "owner/name" of the scan's repository. Absent: the env default, exactly as before scans could choose one. */
  repo?: string;
  /** The primary lane's emitter; its idle status is already in the Worker. */
  emitter: LaneEmitter;
}

export class RunManager {
  private readonly active = new Set<string>();

  constructor(
    private readonly config: Config,
    private readonly worker: WorkerClient,
    private readonly sessions: Semaphore,
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
   * Live browser work waits for a session slot; mock work holds no browser.
   * The pool is entered synchronously, so callers queue in call order.
   */
  private withSession<T>(work: () => Promise<T>): Promise<T> {
    return this.mock ? work() : this.sessions.run(work);
  }

  /** POST /runs: one task, started in the background. */
  async start(url: string, task: string): Promise<string> {
    const run = await this.create(url, task);
    void this.execute(run);
    return run.runId;
  }

  /**
   * Creates the run and posts the primary lane's `idle` status before
   * returning. That matters: the Worker's stream treats a run with no events
   * as having no producer and falls back to the fixture, so the producer has
   * to be visibly attached before the UI can possibly connect.
   */
  async create(url: string, task: string, options: { scan?: ScanTaskLink; successCheck?: string; repo?: string } = {}): Promise<PreparedRun> {
    const runId = await this.worker.createRun(url, task, options.scan);
    const emitter = new LaneEmitter(this.worker, runId, "primary", task, this.judge());
    emitter.status("idle", this.mock ? "Queued (mock mode)." : "Queued. Waiting for a browser session.");
    await emitter.flush();
    return { runId, url, task, successCheck: options.successCheck, repo: options.repo, emitter };
  }

  /**
   * Runs the agent, then verifies its top findings. Never rejects; resolves
   * with the primary outcome once the whole pipeline is over. The primary
   * lane enters the session pool synchronously, so calling execute() for
   * several runs in order gives them browsers in that order.
   */
  async execute(run: PreparedRun): Promise<Outcome> {
    this.active.add(run.runId);
    try {
      return await this.run(run);
    } catch (err) {
      log("run", `${run.runId} stopped: ${errorMessage(err)}`);
      return "failure";
    } finally {
      this.active.delete(run.runId);
    }
  }

  private async run(run: PreparedRun): Promise<Outcome> {
    const { runId, emitter } = run;
    const willVerify = (): boolean => this.config.verifyTopN > 0 && emitter.findings.length > 0;
    // Mark the run as verifying BEFORE the primary done event, or the Worker would call it complete.
    const beforeDone = async (): Promise<void> => {
      if (willVerify()) await this.worker.patchRun(runId, { status: "verifying" });
    };

    const primary = await this.withSession(() => this.runPrimary(run, beforeDone));
    if (!willVerify()) return primary.outcome;
    try {
      await this.verifyTopFindings(run, primary);
    } catch (err) {
      log("run", `${runId} verification stopped: ${errorMessage(err)}`);
    } finally {
      // Whatever happened, the run is over: the stream ends and the UI stops waiting.
      await this.worker.patchRun(runId, { status: "completed" });
    }
    return primary.outcome;
  }

  private async runPrimary(run: PreparedRun, beforeDone: () => Promise<void>): Promise<AgentResult> {
    const { config, worker } = this;
    const { runId, url, task, emitter } = run;
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
            successCheck: run.successCheck,
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
  private async verifyTopFindings(run: PreparedRun, primary: AgentResult): Promise<void> {
    const { config, worker } = this;
    const { runId, url, task, emitter } = run;
    const steps = emitter.events.filter((e): e is StepEvent => e.type === "step");
    const candidates = emitter.findings.flatMap((f) => {
      const finding = f.payload ? findingForFix(f.payload, steps) : null;
      return finding ? [{ finding, findingId: finding.findingId, severity: finding.severity, confidence: f.payload?.confidence ?? 0, hitCount: finding.hitCount }] : [];
    });
    const top = selectTopFindings(candidates, config.verifyTopN);
    log("run", `${runId} verifying the top ${top.length} of ${candidates.length} findings: ${top.map((t) => `${t.findingId} ${t.finding.category}`).join(", ")}`);

    const before: LaneResult = { outcome: primary.outcome, steps: primary.steps, durationMs: primary.durationMs };
    const proposer: FixProposer = this.mock ? goldenFixer(config.mockSpeed) : openAIFixer(config);
    // A scan's runs map to the scan's repository; any other run to the env default.
    const github = run.repo ? githubFor(config, run.repo) : config.github;
    const sourceFixer: SourceFixer | null = github && !this.mock ? openAISourceFixer(config) : null;
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

        const floor = seqFloor;
        const outcome = await this.withSession(() =>
          verifyFix({
            runId,
            url,
            task,
            successCheck: run.successCheck,
            config,
            worker,
            report,
            finding,
            before,
            seqFloor: floor,
            planner: this.mock ? null : new OpenAIPlanner(config),
            judge: this.judge(),
          }),
        );
        seqFloor = outcome.lastSeq;

        if (outcome.verdict.stage === "verified") {
          if (this.mock) await this.mockMapToSource(run, finding, report);
          else await this.mapToSource(finding, report, github, sourceFixer);
        }
        seqFloor = Math.max(seqFloor, report.lastSeq);
      } catch (err) {
        log("run", `${runId} ${finding.findingId}: ${errorMessage(err)}`);
      }
    }
  }

  /** Verified: find the source file and generate its new content. Unmapped is a normal ending. */
  private async mapToSource(finding: FindingForFix, report: FixReport, github: GitHubConfig | null, sourceFixer: SourceFixer | null): Promise<void> {
    if (!github || !sourceFixer) {
      log("run", `${finding.findingId}: verified; no repository connected, so it stays unmapped`);
      return;
    }
    const sourceFile = await findSourceFile(github, finding);
    if (!sourceFile) return;
    try {
      const newFileContent = await generateSourceFix(sourceFixer, finding, report.state, sourceFile);
      // Held on the fix row until a pull request is opened for it.
      await report.update({ sourceFile: sourceFile.path, newFileContent, sourceSha: sourceFile.sha });
    } catch (err) {
      log("run", `${finding.findingId}: mapped to ${sourceFile.path}, but no acceptable new content: ${errorMessage(err)}`);
    }
  }

  /**
   * Mock mode has no repository and no model, so nothing is ever mapped. For a
   * scan started with a repository, the CANNED mapping of mockSource.ts stands
   * in, so the scan can end with pull request previews. Never outside a scan.
   */
  private async mockMapToSource(run: PreparedRun, finding: FindingForFix, report: FixReport): Promise<void> {
    const canned = run.repo ? mockSourceFix(finding.category) : null;
    if (!canned) return;
    log("run", `${finding.findingId}: mock mode, canned mapping to ${canned.path}`);
    await report.update({ sourceFile: canned.path, newFileContent: canned.content, sourceSha: null });
  }
}
