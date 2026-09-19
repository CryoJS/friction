/**
 * One per persona. Owns that persona's seq counter (monotonic across every
 * event type), keeps the local event log the detectors run over, and delivers
 * events to the Worker strictly in order without ever blocking the step loop.
 */
import {
  PERSONA_BY_ID,
  judgeCandidate,
  newCandidates,
  toFrictionPayload,
  type DonePayload,
  type FrictionPayload,
  type PersonaId,
  type PersonaState,
  type RunEvent,
  type StepEvent,
  type StepPayload,
  type StructuredCaller,
} from "@friction/shared";
import { errorMessage, log } from "./util";
import type { WorkerClient } from "./workerClient";

export class PersonaEmitter {
  /** Everything this persona has emitted, in order. The detectors' input. */
  readonly events: RunEvent[] = [];
  private seq = 0;
  private delivery: Promise<unknown> = Promise.resolve();
  private readonly emittedFriction = new Set<string>();
  private readonly judging: Array<Promise<void>> = [];
  private frictionTotal = 0;

  constructor(
    private readonly worker: WorkerClient,
    readonly runId: string,
    readonly personaId: PersonaId,
    private readonly task: string,
    /** Omit to fall back to heuristic judgements (mock mode, or no OpenAI key). */
    private readonly judge?: StructuredCaller,
  ) {}

  get frictionCount(): number {
    return this.frictionTotal;
  }

  get stepCount(): number {
    return this.events.filter((e) => e.type === "step").length;
  }

  private emit(event: RunEvent): void {
    this.events.push(event);
    // Chained so events reach the Worker in seq order even though nobody awaits them.
    this.delivery = this.delivery.then(() => this.worker.postEvents(this.runId, [event]));
  }

  private envelope(): { runId: string; personaId: PersonaId; seq: number; ts: number } {
    this.seq += 1;
    return { runId: this.runId, personaId: this.personaId, seq: this.seq, ts: Date.now() };
  }

  status(state: PersonaState, message?: string): void {
    const base = this.envelope();
    this.emit({ ...base, type: "status", payload: { state, currentSeq: base.seq, ...(message ? { message } : {}) } });
  }

  /** Emits the step, then runs the detectors over everything so far. */
  step(payload: StepPayload): StepEvent {
    const event: StepEvent = { ...this.envelope(), type: "step", payload };
    this.emit(event);
    this.detect();
    return event;
  }

  friction(payload: FrictionPayload): void {
    this.frictionTotal += 1;
    this.emit({ ...this.envelope(), type: "friction", payload });
  }

  done(payload: Omit<DonePayload, "frictionCount" | "totalSteps">): void {
    this.emit({ ...this.envelope(), type: "done", payload: { ...payload, totalSteps: this.stepCount, frictionCount: this.frictionTotal } });
  }

  /**
   * Deterministic detectors first, then one judgement call per NEW candidate.
   * Judging runs in the background so a slow model never stalls the persona;
   * settle() waits for stragglers before the done event.
   */
  private detect(): void {
    for (const candidate of newCandidates(this.events, this.emittedFriction)) {
      this.emittedFriction.add(candidate.key);
      const recentSteps = this.events.filter((e): e is StepEvent => e.type === "step");
      const work = judgeCandidate(candidate, { task: this.task, persona: PERSONA_BY_ID[this.personaId], recentSteps }, this.judge)
        .then((finding) => {
          log(this.personaId, `friction: ${candidate.category} S${finding.severity} (${finding.judgedBy}) ${candidate.summary}`);
          this.friction(toFrictionPayload(candidate, finding));
        })
        .catch((err) => log(this.personaId, `judging ${candidate.key} failed: ${errorMessage(err)}`));
      this.judging.push(work);
    }
  }

  /** Wait for in-flight judgements, so frictionCount in the done event is final. */
  async settle(): Promise<void> {
    await Promise.allSettled(this.judging);
  }

  /** Wait until every event has been handed to the Worker. */
  async flush(): Promise<void> {
    await this.delivery.catch(() => undefined);
  }
}
