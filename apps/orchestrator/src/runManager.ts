/**
 * A run = three personas, concurrently, each isolated from the others' failures.
 *
 * create() and execute() are separate so a scan can create all its runs (and
 * post every persona's idle status) before any of them starts. Live personas
 * wait for a slot in the process-wide session pool; mock personas hold no
 * browser, so they skip it.
 */
import { PERSONAS, type Outcome, type PersonaId, type ScanTaskLink } from "@friction/shared";
import type { Config } from "./config";
import { PersonaEmitter } from "./emitter";
import { openAIJudge } from "./judge";
import { goldenJudge, runMockPersona } from "./mockRunner";
import { runPersona } from "./personaRunner";
import { OpenAIPlanner } from "./planner";
import { errorMessage, log, type Semaphore } from "./util";
import type { WorkerClient } from "./workerClient";

export interface PreparedRun {
  runId: string;
  url: string;
  task: string;
  /** From a scan's generated task: tells the planner what "done" looks like. */
  successCheck?: string;
  emitters: Map<PersonaId, PersonaEmitter>;
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

  /** POST /runs: one task, started in the background. */
  async start(url: string, task: string): Promise<string> {
    const run = await this.create(url, task);
    void this.execute(run);
    return run.runId;
  }

  /**
   * Creates the run and posts every persona's `idle` status before returning.
   * That matters: the Worker's stream treats a run with no events as having no
   * producer and falls back to the fixture, so the producer has to be visibly
   * attached before the UI can possibly connect.
   */
  async create(url: string, task: string, options: { scan?: ScanTaskLink; successCheck?: string } = {}): Promise<PreparedRun> {
    const runId = await this.worker.createRun(url, task, options.scan);
    const mock = this.config.mode === "mock";
    const judge = mock ? null : openAIJudge(this.config);

    const emitters = new Map<PersonaId, PersonaEmitter>();
    for (const persona of PERSONAS) {
      const emitter = new PersonaEmitter(this.worker, runId, persona.id, task, judge ?? goldenJudge(persona.id, this.config.mockSpeed));
      emitter.status("idle", mock ? "Queued (mock mode)." : "Queued. Waiting for a browser session.");
      emitters.set(persona.id, emitter);
    }
    await Promise.all([...emitters.values()].map((emitter) => emitter.flush()));
    return { runId, url, task, successCheck: options.successCheck, emitters };
  }

  /**
   * Runs the three personas. Never rejects. The session pool is entered
   * synchronously, so calling execute() for several runs in order queues their
   * personas in that order.
   */
  async execute(run: PreparedRun): Promise<Outcome[]> {
    const { config, worker } = this;
    const planner = config.mode === "live" ? new OpenAIPlanner(config) : null;
    this.active.add(run.runId);
    log("run", `${run.runId} started in ${config.mode} mode: ${run.task} @ ${run.url}`);

    try {
      // Promise.all over personas that cannot reject: one crash never takes the others down.
      const outcomes = await Promise.all(
        PERSONAS.map((persona) => {
          const emitter = run.emitters.get(persona.id) as PersonaEmitter;
          const work = async (): Promise<Outcome> => {
            try {
              if (!planner) return await runMockPersona({ runId: run.runId, persona, config, worker, emitter });
              return await runPersona({ runId: run.runId, url: run.url, task: run.task, successCheck: run.successCheck, persona, config, worker, planner, emitter });
            } catch (err) {
              // runPersona handles its own failures; this is the belt to its braces.
              log(persona.id, `unexpected failure: ${errorMessage(err)}`);
              emitter.status("failed", `Crashed: ${errorMessage(err)}`);
              emitter.done({ outcome: "failure", durationMs: 0, summary: `Crashed: ${errorMessage(err)}` });
              await emitter.flush();
              return "failure";
            }
          };
          return planner ? this.sessions.run(work) : work();
        }),
      );
      log("run", `${run.runId} finished: ${PERSONAS.map((p, i) => `${p.id}=${outcomes[i]}`).join(" ")}`);
      return outcomes;
    } finally {
      this.active.delete(run.runId);
    }
  }
}
