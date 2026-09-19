/**
 * A run = three personas, concurrently, each isolated from the others' failures.
 */
import { PERSONAS, type Outcome, type PersonaDefinition } from "@friction/shared";
import type { Config } from "./config";
import { PersonaEmitter } from "./emitter";
import { openAIJudge } from "./judge";
import { goldenJudge, runMockPersona } from "./mockRunner";
import { runPersona } from "./personaRunner";
import { OpenAIPlanner } from "./planner";
import { Semaphore, errorMessage, log } from "./util";
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

  /**
   * Creates the run and returns its id immediately; the personas run in the
   * background. Before returning, every persona's `idle` status is already in
   * the Worker. That matters: the Worker's stream treats a run with no events
   * as having no producer and falls back to the fixture, so the producer has
   * to be visibly attached before the UI can possibly connect.
   */
  async start(url: string, task: string): Promise<string> {
    const runId = await this.worker.createRun(url, task);
    const mock = this.config.mode === "mock";
    const judge = mock ? null : openAIJudge(this.config);

    const emitters = new Map<PersonaDefinition["id"], PersonaEmitter>();
    for (const persona of PERSONAS) {
      const emitter = new PersonaEmitter(this.worker, runId, persona.id, task, judge ?? goldenJudge(persona.id, this.config.mockSpeed));
      emitter.status("idle", mock ? "Queued (mock mode)." : "Queued. Starting a Browserbase session.");
      emitters.set(persona.id, emitter);
    }
    await Promise.all([...emitters.values()].map((emitter) => emitter.flush()));

    this.active.add(runId);
    void this.runAll(runId, url, task, emitters).finally(() => this.active.delete(runId));
    return runId;
  }

  private async runAll(runId: string, url: string, task: string, emitters: Map<PersonaDefinition["id"], PersonaEmitter>): Promise<void> {
    const { config, worker } = this;
    const slots = new Semaphore(config.personaConcurrency);
    const planner = config.mode === "live" ? new OpenAIPlanner(config) : null;
    log("run", `${runId} started in ${config.mode} mode: ${task} @ ${url}`);

    // Promise.all over personas that cannot reject: one crash never takes the others down.
    const outcomes = await Promise.all(
      PERSONAS.map((persona) =>
        slots.run(async (): Promise<Outcome> => {
          const emitter = emitters.get(persona.id) as PersonaEmitter;
          try {
            if (!planner) return await runMockPersona({ runId, persona, config, worker, emitter });
            return await runPersona({ runId, url, task, persona, config, worker, planner, emitter });
          } catch (err) {
            // runPersona handles its own failures; this is the belt to its braces.
            log(persona.id, `unexpected failure: ${errorMessage(err)}`);
            emitter.status("failed", `Crashed: ${errorMessage(err)}`);
            emitter.done({ outcome: "failure", durationMs: 0, summary: `Crashed: ${errorMessage(err)}` });
            await emitter.flush();
            return "failure";
          }
        }),
      ),
    );
    log("run", `${runId} finished: ${PERSONAS.map((p, i) => `${p.id}=${outcomes[i]}`).join(" ")}`);
  }
}
