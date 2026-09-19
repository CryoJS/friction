/**
 * The control room's model of a run, and the pure functions that evolve it.
 * Live SSE and client-side replay both go through applyEvent, so the two modes
 * cannot drift apart. Everything here tolerates duplicates and out-of-order
 * arrival: the stream may overlap on reconnect.
 */
import {
  PERSONAS,
  PERSONA_IDS,
  eventKey,
  isTerminalState,
  stateForOutcome,
  type DataSource,
  type DoneEvent,
  type FrictionEvent,
  type PersonaDefinition,
  type PersonaId,
  type PersonaRecord,
  type PersonaState,
  type RunEvent,
  type RunRecord,
  type RunSnapshot,
  type StepEvent,
  type StreamHello,
} from "@friction/shared";

export interface PersonaView {
  def: PersonaDefinition;
  state: PersonaState;
  statusMessage: string | null;
  liveViewUrl: string | null;
  sessionId: string | null;
  replayUrl: string | null;
  /** Ascending by seq. */
  steps: StepEvent[];
  /** Ascending by seq. */
  frictions: FrictionEvent[];
  done: DoneEvent | null;
  /** Seq of the newest state-bearing event applied, so stale ones are ignored. */
  stateSeq: number;
}

export interface RunView {
  runId: string;
  run: RunRecord | null;
  source: DataSource | null;
  personas: Record<PersonaId, PersonaView>;
  seen: ReadonlySet<string>;
  firstTs: number | null;
  lastTs: number | null;
}

function emptyPersona(def: PersonaDefinition): PersonaView {
  return {
    def,
    state: "idle",
    statusMessage: null,
    liveViewUrl: null,
    sessionId: null,
    replayUrl: null,
    steps: [],
    frictions: [],
    done: null,
    stateSeq: -1,
  };
}

export function emptyRunView(runId: string): RunView {
  const personas = Object.fromEntries(PERSONAS.map((def) => [def.id, emptyPersona(def)])) as Record<PersonaId, PersonaView>;
  return { runId, run: null, source: null, personas, seen: new Set(), firstTs: null, lastTs: null };
}

function insertBySeq<T extends { seq: number }>(list: readonly T[], item: T): T[] {
  const last = list[list.length - 1];
  if (!last || last.seq < item.seq) return [...list, item];
  return [...list, item].sort((a, b) => a.seq - b.seq);
}

export function applyEvent(view: RunView, event: RunEvent): RunView {
  const key = eventKey(event);
  if (view.seen.has(key)) return view;
  const seen = new Set(view.seen);
  seen.add(key);

  const current = view.personas[event.personaId];
  let next: PersonaView = current;

  switch (event.type) {
    case "status":
      // A terminal state is final, and an older status never overrides a newer one.
      if (event.seq > current.stateSeq && !isTerminalState(current.state)) {
        next = { ...current, state: event.payload.state, statusMessage: event.payload.message ?? null, stateSeq: event.seq };
      } else if (event.payload.message && isTerminalState(event.payload.state)) {
        next = { ...current, statusMessage: event.payload.message };
      }
      break;
    case "step": {
      const running = current.state === "idle" ? "running" : current.state;
      next = { ...current, state: running, steps: insertBySeq(current.steps, event) };
      break;
    }
    case "friction":
      next = { ...current, frictions: insertBySeq(current.frictions, event) };
      break;
    case "done":
      next = { ...current, done: event, state: stateForOutcome(event.payload.outcome), stateSeq: Math.max(current.stateSeq, event.seq) };
      break;
  }

  return {
    ...view,
    seen,
    personas: { ...view.personas, [event.personaId]: next },
    firstTs: view.firstTs === null ? event.ts : Math.min(view.firstTs, event.ts),
    lastTs: view.lastTs === null ? event.ts : Math.max(view.lastTs, event.ts),
  };
}

/** Session details arrive out of band (PATCH), never as events. Events own the state. */
export function applyPersonaRecord(view: RunView, record: PersonaRecord): RunView {
  const current = view.personas[record.personaId];
  if (!current) return view;
  const untouched = current.stateSeq < 0 && current.steps.length === 0;
  const next: PersonaView = {
    ...current,
    liveViewUrl: record.liveViewUrl ?? current.liveViewUrl,
    sessionId: record.sessionId ?? current.sessionId,
    replayUrl: record.replayUrl ?? current.replayUrl,
    state: untouched ? record.state : current.state,
  };
  return { ...view, personas: { ...view.personas, [record.personaId]: next } };
}

export function applyHello(view: RunView, hello: StreamHello): RunView {
  const withRun: RunView = { ...view, run: hello.run ?? view.run, source: hello.mode };
  return hello.personas.reduce(applyPersonaRecord, withRun);
}

/** The view after the first `count` events of a snapshot. Drives replay and seeking. */
export function viewFromSnapshot(snapshot: RunSnapshot, count: number): RunView {
  let view: RunView = { ...emptyRunView(snapshot.run.id), run: snapshot.run, source: snapshot.source };
  for (const record of snapshot.personas) {
    // Keep the session links, but let the replayed events rebuild the state.
    view = applyPersonaRecord(view, { ...record, state: "idle", stepCount: 0 });
  }
  const limit = Math.min(count, snapshot.events.length);
  for (let i = 0; i < limit; i++) {
    const event = snapshot.events[i];
    if (event) view = applyEvent(view, event);
  }
  return view;
}

/** Everything the UI currently knows, in snapshot form (feeds the offline report). */
export function snapshotFromView(view: RunView): RunSnapshot | null {
  if (!view.run) return null;
  const events: RunEvent[] = [];
  const personas: PersonaRecord[] = [];
  for (const id of PERSONA_IDS) {
    const p = view.personas[id];
    events.push(...p.steps, ...p.frictions);
    if (p.done) events.push(p.done);
    personas.push({
      id: `${view.runId}:${id}`,
      runId: view.runId,
      personaId: id,
      state: p.state,
      stepCount: p.steps.length,
      liveViewUrl: p.liveViewUrl,
      sessionId: p.sessionId,
      replayUrl: p.replayUrl,
    });
  }
  return { run: view.run, personas, events, source: view.source ?? "live" };
}

export type RunPhase = "waiting" | "running" | "complete";

export interface RunSummary {
  phase: RunPhase;
  label: string;
  tone: "neutral" | "active" | "good" | "bad" | "mixed";
  succeeded: number;
  finished: number;
  frictionCount: number;
  stepCount: number;
}

export function summarize(view: RunView): RunSummary {
  const all = PERSONA_IDS.map((id) => view.personas[id]);
  const finished = all.filter((p) => isTerminalState(p.state)).length;
  const succeeded = all.filter((p) => p.state === "succeeded").length;
  const frictionCount = all.reduce((n, p) => n + p.frictions.length, 0);
  const stepCount = all.reduce((n, p) => n + p.steps.length, 0);
  const base = { succeeded, finished, frictionCount, stepCount };

  if (finished === all.length) {
    const tone = succeeded === all.length ? "good" : succeeded === 0 ? "bad" : "mixed";
    return { ...base, phase: "complete", tone, label: `Complete · ${succeeded}/${all.length} succeeded` };
  }
  if (all.every((p) => p.state === "idle") && stepCount === 0) {
    return { ...base, phase: "waiting", tone: "neutral", label: "Starting sessions" };
  }
  return { ...base, phase: "running", tone: "active", label: `Running · ${finished}/${all.length} finished` };
}
