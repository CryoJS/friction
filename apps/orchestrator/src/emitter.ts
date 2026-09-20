/**
 * One per lane. Owns that lane's seq counter (monotonic across every event
 * type), keeps the local event log the detectors run over, and delivers events
 * to the Worker strictly in order without ever blocking the step loop.
 *
 * Findings are deduplicated here by category + selector. The first hit of a
 * finding is judged once and emitted under a new findingId; every later hit
 * re-emits the same finding with the stored judgement and a higher hitCount.
 * No second model call, and "the agent hit this 3 times" is on the record.
 */
import {
  judgeCandidate,
  newCandidates,
  toFrictionPayload,
  type AgentState,
  type DonePayload,
  type FrictionCandidate,
  type FrictionPayload,
  type JudgedFinding,
  type Lane,
  type RunEvent,
  type StepEvent,
  type StepPayload,
  type StructuredCaller,
} from "@friction/shared";
import { errorMessage, log } from "./util";
import type { WorkerClient } from "./workerClient";

/** A deduplicated finding as the emitter knows it. */
export interface TrackedFinding {
  findingId: string | null;
  first: FrictionCandidate;
  hitCount: number;
  judged: Promise<JudgedFinding>;
  /** The latest payload emitted for it. */
  payload: FrictionPayload | null;
}

export class LaneEmitter {
  /** Everything this lane has emitted, in order. The detectors' input. */
  readonly events: RunEvent[] = [];
  private seq: number;
  private delivery: Promise<unknown> = Promise.resolve();
  private readonly seenOccurrences = new Set<string>();
  private readonly tracked = new Map<string, TrackedFinding>();
  private readonly judging: Array<Promise<void>> = [];

  constructor(
    private readonly worker: WorkerClient,
    readonly runId: string,
    readonly lane: Lane,
    private readonly task: string,
    /** Omit to fall back to heuristic judgements (mock mode, or no OpenAI key). */
    private readonly judge?: StructuredCaller,
    /** Where this lane's seq counter starts (a lane shared by several runs continues from the last). */
    startSeq = 0,
    /** Verify lane: the finding whose fix this run verifies. Stamped on every envelope. */
    readonly fixId?: string,
  ) {
    this.seq = startSeq;
  }

  /** Distinct findings so far. */
  get frictionCount(): number {
    return this.tracked.size;
  }

  get stepCount(): number {
    return this.events.filter((e) => e.type === "step").length;
  }

  /** The last seq handed out. */
  get lastSeq(): number {
    return this.seq;
  }

  /** Every finding emitted so far, with its latest payload. */
  get findings(): TrackedFinding[] {
    return [...this.tracked.values()].filter((f) => f.payload !== null);
  }

  private emit(event: RunEvent): void {
    this.events.push(event);
    // Chained so events reach the Worker in seq order even though nobody awaits them.
    this.delivery = this.delivery.then(() => this.worker.postEvents(this.runId, [event]));
  }

  private envelope(): { runId: string; lane: Lane; seq: number; ts: number; fixId?: string } {
    this.seq += 1;
    return { runId: this.runId, lane: this.lane, seq: this.seq, ts: Date.now(), ...(this.fixId ? { fixId: this.fixId } : {}) };
  }

  status(state: AgentState, message?: string, session?: { liveViewUrl: string | null; replayUrl: string | null }): void {
    const base = this.envelope();
    this.emit({ ...base, type: "status", payload: { state, currentSeq: base.seq, ...(message ? { message } : {}), ...(session ? { session } : {}) } });
  }

  /** Emits the step, then runs the detectors over everything so far. */
  step(payload: StepPayload): StepEvent {
    const event: StepEvent = { ...this.envelope(), type: "step", payload };
    this.emit(event);
    this.detect();
    return event;
  }

  private friction(finding: TrackedFinding, payload: Omit<FrictionPayload, "findingId">): void {
    const base = this.envelope();
    finding.findingId ??= `f${base.seq}`;
    // The overlay needs one payload, so the evidence step's anchor is copied onto the finding.
    const evidence = this.events.find((e) => e.type === "step" && e.seq === payload.evidenceSeq);
    const anchor = evidence?.type === "step" ? evidence.payload.anchor : undefined;
    finding.payload = { ...payload, findingId: finding.findingId, ...(anchor ? { anchor } : {}) };
    this.emit({ ...base, type: "friction", payload: finding.payload });
  }

  done(payload: Omit<DonePayload, "frictionCount" | "totalSteps">): void {
    this.emit({ ...this.envelope(), type: "done", payload: { ...payload, totalSteps: this.stepCount, frictionCount: this.frictionCount } });
  }

  /**
   * Deterministic detectors first. A new finding gets one judgement call; a
   * repeat of a known one (same category + selector) reuses it. Both run in
   * the background so a slow model never stalls the agent; a repeat is chained
   * on the first hit's judgement, so it is always emitted after it.
   */
  private detect(): void {
    for (const candidate of newCandidates(this.events, this.seenOccurrences)) {
      this.seenOccurrences.add(candidate.key);
      const known = this.tracked.get(candidate.findingKey);

      if (!known) {
        const recentSteps = this.events.filter((e): e is StepEvent => e.type === "step");
        const finding: TrackedFinding = {
          findingId: null,
          first: candidate,
          hitCount: 1,
          judged: judgeCandidate(candidate, { task: this.task, recentSteps }, this.judge),
          payload: null,
        };
        this.tracked.set(candidate.findingKey, finding);
        this.judging.push(
          finding.judged
            .then((judged) => {
              log(this.lane, `friction: ${candidate.category} S${judged.severity} (${judged.judgedBy}) ${candidate.summary}`);
              this.friction(finding, toFrictionPayload(candidate, judged));
            })
            .catch((err) => log(this.lane, `judging ${candidate.key} failed: ${errorMessage(err)}`)),
        );
        continue;
      }

      known.hitCount += 1;
      const hitCount = known.hitCount;
      this.judging.push(
        known.judged
          .then((judged) => {
            log(this.lane, `friction: ${candidate.category} hit ${hitCount}x on ${candidate.findingKey}`);
            this.friction(known, toFrictionPayload(known.first, judged, { hit: candidate, hitCount }));
          })
          .catch((err) => log(this.lane, `repeat of ${candidate.key} failed: ${errorMessage(err)}`)),
      );
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
