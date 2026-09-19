/**
 * A run = one agent attempting one task in the primary lane, then, for the
 * VERIFY_TOP_N findings planVerification selects (causes before symptoms), one
 * at a time:
 *
 *   proposeFix -> verifyFix -> (if verified) findSourceFile -> generateSourceFix
 *
 * with one retry for a fix that ran and was rejected, all under
 * VERIFY_MAX_RUNS, and then it waits. A pull request is opened when the user clicks "Open pull
 * request" in the control room (see pr.ts), or, for a scan started with
 * automatic pull requests, by the scan once all its runs are over (see
 * scanPullRequests.ts); never by the run itself.
 *
 * create() and execute() are separate so a scan can create all its runs (and
 * post every primary lane's idle status) before any of them starts. Every live
 * browser, primary or verify, waits for a slot in the process-wide session
 * pool; mock runs hold no browser, so they skip it.
 */
import {
  evidenceKey,
  isSymptomCategory,
  planVerification,
  type FrictionCategory,
  type LaneResult,
  type Outcome,
  type ScanTaskLink,
  type StepEvent,
  type StructuredCaller,
} from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { runAgent, type AgentResult } from "./agentRunner";
import { githubFor, type Config, type GitHubConfig } from "./config";
import { LaneEmitter } from "./emitter";
import { openAIFixer, proposeAndReport, type FindingForFix, type FixProposer } from "./fixer";
import type { FixReport } from "./fixReport";
import { openAIJudge } from "./judge";
import { goldenFixer, goldenJudge, runMockAgent } from "./mockRunner";
import { mockSourceFix } from "./mockSource";
import { OpenAIPlanner } from "./planner";
import { findSourceFile, generateSourceFix, openAISourceFixer, type SourceFixer } from "./repo";
import { scheduleVerifications, verificationCandidates, type AttemptResult } from "./selection";
import { errorMessage, log, truncate, type Semaphore } from "./util";
import { hasRecordedVerifyRun, verifyFix } from "./verify";
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
   * Which findings are verified is planVerification's call: causes before
   * symptoms, one verification per element, VERIFY_TOP_N of them. One at a
   * time: each verification is its own browser run, and one at a time keeps
   * the verify lane's seqs in one order. After every finding has had its first
   * attempt, a fixable finding whose fix ran and was rejected with "still
   * fires" gets ONE more proposal, with that rejection as feedback, while the
   * run's verifications stay under VERIFY_MAX_RUNS. Every stage is reported as
   * it happens; a failure on one finding never stops the next.
   */
  private async verifyTopFindings(run: PreparedRun, primary: AgentResult): Promise<void> {
    const { config, worker } = this;
    const { runId, url, task, emitter } = run;
    const steps = emitter.events.filter((e): e is StepEvent => e.type === "step");
    const candidates = verificationCandidates(emitter.findings.flatMap((f) => (f.payload ? [f.payload] : [])), steps);
    const plan = planVerification(candidates, config.verifyTopN);
    log("run", `${runId} verifying ${plan.selected.length} of ${candidates.length} findings: ${plan.selected.map((t) => `${t.findingId} ${t.category}`).join(", ")}`);
    for (const skipped of plan.notSelected) log("run", `${runId} ${skipped.finding.findingId} ${skipped.finding.category} not selected: ${skipped.why}${skipped.sameCauseAs ? ` as ${skipped.sameCauseAs}` : ""}`);

    const before: LaneResult = { outcome: primary.outcome, steps: primary.steps, durationMs: primary.durationMs };
    const proposer: FixProposer = this.mock ? goldenFixer(config.mockSpeed) : openAIFixer(config);
    // A scan's runs map to the scan's repository; any other run to the env default.
    const github = run.repo ? githubFor(config, run.repo) : config.github;
    const sourceFixer: SourceFixer | null = github && !this.mock ? openAISourceFixer(config) : null;
    const hitsBefore = (category: FrictionCategory): number => candidates.filter((c) => c.category === category).reduce((n, c) => n + c.hitCount, 0);
    let seqFloor = 0;
    /** Findings that have had a fix proposed: a symptom among them is told by its own fix, never credited. */
    const attempted = new Set<string>();
    /** Symptom findings a verified fix already accounts for: no fix of their own. */
    const credited = new Set<string>();

    /** Propose (or re-propose onto `retryOf`), verify, and on "verified" credit the symptoms and map to source. */
    const attempt = async (finding: FindingForFix, retryOf?: FixReport): Promise<AttemptResult<FixReport>> => {
      let ran = false;
      try {
        if (retryOf) log("run", `${runId} ${finding.findingId}: retrying once with the rejection as feedback (${retryOf.state.note ?? ""})`);
        const report = await proposeAndReport({
          worker,
          runId,
          proposer,
          input: {
            task,
            finding,
            stepEvents: steps,
            tree: primary.trees.get(finding.evidenceSeq) ?? null,
            ...(retryOf ? { previous: { patchJs: retryOf.state.patchJs, note: retryOf.state.note ?? "" } } : {}),
          },
          retryOf,
        });
        if (!report) return { ran, outcome: null };
        attempted.add(finding.findingId);
        seqFloor = Math.max(seqFloor, report.lastSeq);

        const floor = seqFloor;
        ran = true;
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
            categoryHitsBefore: hitsBefore(finding.category),
            seqFloor: floor,
            planner: this.mock ? null : new OpenAIPlanner(config),
            judge: this.judge(),
          }),
        );
        seqFloor = outcome.lastSeq;

        if (outcome.verdict.stage === "verified") {
          if (!isSymptomCategory(finding.category)) {
            const resolved = candidates.filter(
              (c) => isSymptomCategory(c.category) && !credited.has(c.findingId) && !attempted.has(c.findingId) && !outcome.firedCategories.has(c.category),
            );
            if (resolved.length > 0) {
              resolved.forEach((c) => credited.add(c.findingId));
              await report.update({ alsoResolved: resolved.map((c) => ({ findingId: c.findingId, category: c.category })) });
              log("run", `${runId} ${finding.findingId}: also resolved ${resolved.map((c) => `${c.findingId} ${c.category}`).join(", ")}`);
            }
          }
          if (this.mock) await this.mockMapToSource(run, finding, report);
          else await this.mapToSource(finding, report, github, sourceFixer);
        }
        seqFloor = Math.max(seqFloor, report.lastSeq);
        return { ran, outcome: { report, verdict: outcome.verdict } };
      } catch (err) {
        log("run", `${runId} ${finding.findingId}: ${errorMessage(err)}`);
        return { ran, outcome: null };
      }
    };

    const { used, retried } = await scheduleVerifications({
      selected: plan.selected.map((candidate) => candidate.finding),
      maxRuns: config.verifyMaxRuns,
      skip: (finding) => {
        if (credited.has(finding.findingId)) {
          log("run", `${runId} ${finding.findingId}: ${finding.category} no longer fired with a verified fix applied; no fix of its own`);
          return true;
        }
        // Mock mode replays recorded verify runs, and can verify nothing the fixture did not record.
        if (this.mock && !hasRecordedVerifyRun(finding.category)) {
          log("run", `${runId} ${finding.findingId}: mock mode has no recorded verification for ${finding.category}`);
          return true;
        }
        return false;
      },
      attempt,
    });
    log("run", `${runId} verification over: ${used} of at most ${config.verifyMaxRuns} runs used${retried.length > 0 ? `, retried ${retried.join(", ")}` : ""}`);
  }

  /** Verified: find the source file and generate its new content. Unmapped is a normal ending, and the row says what was searched. */
  private async mapToSource(finding: FindingForFix, report: FixReport, github: GitHubConfig | null, sourceFixer: SourceFixer | null): Promise<void> {
    if (!github || !sourceFixer) {
      log("run", `${finding.findingId}: verified; no repository connected, so it stays unmapped`);
      await report.update({ mappingNote: "No repository is connected, so there was nothing to map it to." });
      return;
    }
    const { file: sourceFile, note } = await findSourceFile(github, finding, report.state.patchJs);
    if (!sourceFile) {
      await report.update({ mappingNote: note });
      return;
    }
    try {
      const newFileContent = await generateSourceFix(sourceFixer, finding, report.state, sourceFile);
      // Held on the fix row until a pull request is opened for it.
      await report.update({ sourceFile: sourceFile.path, newFileContent, sourceSha: sourceFile.sha, mappingNote: note });
    } catch (err) {
      log("run", `${finding.findingId}: mapped to ${sourceFile.path}, but no acceptable new content: ${errorMessage(err)}`);
      await report.update({ mappingNote: truncate(`Found ${sourceFile.path}, but no acceptable change to it was generated: ${errorMessage(err)}`, 500) });
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
