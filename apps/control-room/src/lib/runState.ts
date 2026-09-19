/**
 * The control room's model of a run, and the pure functions that evolve it.
 * Live SSE and client-side replay both go through applyEvent, so the two modes
 * cannot drift apart. Everything here tolerates duplicates and out-of-order
 * arrival: the stream may overlap on reconnect.
 */
import {
  AGENT,
  eventKey,
  findingIdOf,
  isTerminalState,
  isVerdictStage,
  stateForOutcome,
  type AgentState,
  type DataSource,
  type DoneEvent,
  type FixEvent,
  type FrictionEvent,
  type LiveViewResponse,
  type RunEvent,
  type RunRecord,
  type RunSnapshot,
  type StepEvent,
  type StreamHello,
} from "@friction/shared";

/** One agent run as the UI sees it. Primary and verify lanes share this shape. */
export interface LaneView {
  state: AgentState;
  statusMessage: string | null;
  /**
   * Set ONLY by applyLiveView, from a URL the orchestrator minted just now.
   * Never from the stream or the run row: the URL stored there was minted when
   * the session opened and is dead by the time anyone renders it.
   */
  liveViewUrl: string | null;
  sessionId: string | null;
  replayUrl: string | null;
  /** Ascending by seq. */
  steps: StepEvent[];
  /** One entry per finding (its latest emission, so the highest hitCount), ascending by first seq. */
  frictions: FrictionEvent[];
  done: DoneEvent | null;
  /** Seq of the newest state-bearing event applied, so stale ones are ignored. */
  stateSeq: number;
}

export interface RunView {
  runId: string;
  run: RunRecord | null;
  source: DataSource | null;
  primary: LaneView;
  /** One verify run per fix, keyed by the finding id it verifies. */
  verify: Readonly<Record<string, LaneView>>;
  /** The latest fix event per finding id. */
  fixes: Readonly<Record<string, FixEvent>>;
  /** Finding ids in the order their fixes were first proposed. */
  fixOrder: readonly string[];
  seen: ReadonlySet<string>;
  firstTs: number | null;
  lastTs: number | null;
}

export function emptyLane(): LaneView {
  return {
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
  return { runId, run: null, source: null, primary: emptyLane(), verify: {}, fixes: {}, fixOrder: [], seen: new Set(), firstTs: null, lastTs: null };
}

function insertBySeq<T extends { seq: number }>(list: readonly T[], item: T): T[] {
  const last = list[list.length - 1];
  if (!last || last.seq < item.seq) return [...list, item];
  return [...list, item].sort((a, b) => a.seq - b.seq);
}

/** A repeat hit replaces its finding in place; only a higher hitCount wins. */
function upsertFriction(list: readonly FrictionEvent[], event: FrictionEvent): FrictionEvent[] {
  const id = findingIdOf(event);
  const index = list.findIndex((f) => findingIdOf(f) === id);
  if (index < 0) return insertBySeq(list, event);
  const current = list[index] as FrictionEvent;
  if ((event.payload.hitCount ?? 1) <= (current.payload.hitCount ?? 1)) return [...list];
  const next = [...list];
  next[index] = event;
  return next;
}

/** Folds one event into a lane. Pure. */
export function applyToLane(lane: LaneView, event: RunEvent): LaneView {
  switch (event.type) {
    case "status": {
      // The "running" status carries the lane's session. Its liveViewUrl is
      // deliberately ignored (see LaneView.liveViewUrl); replayUrl is permanent.
      const session = event.payload.session;
      const withSession = session ? { ...lane, replayUrl: session.replayUrl ?? lane.replayUrl } : lane;
      // A terminal state is final, and an older status never overrides a newer one.
      if (event.seq > lane.stateSeq && !isTerminalState(lane.state)) {
        return { ...withSession, state: event.payload.state, statusMessage: event.payload.message ?? null, stateSeq: event.seq };
      }
      if (event.payload.message && isTerminalState(event.payload.state)) return { ...withSession, statusMessage: event.payload.message };
      return withSession;
    }
    case "step":
      return { ...lane, state: lane.state === "idle" ? "running" : lane.state, steps: insertBySeq(lane.steps, event) };
    case "friction":
      return { ...lane, frictions: upsertFriction(lane.frictions, event) };
    case "done":
      return { ...lane, done: event, state: stateForOutcome(event.payload.outcome), stateSeq: Math.max(lane.stateSeq, event.seq) };
    case "fix":
      // A fix belongs to the run, not to a lane's timeline (see applyEvent).
      return lane;
  }
}

/**
 * Puts a freshly minted live view URL on the one lane whose session is open,
 * and clears every other lane's. `live` is null when the orchestrator has not
 * answered yet or is unreachable, which correctly means "show no live view":
 * a lane keeping a URL it can no longer connect to is exactly the dead
 * DevTools iframe this replaced.
 */
export function applyLiveView(view: RunView, live: LiveViewResponse | null): RunView {
  const url = live?.liveViewUrl ?? null;
  const onPrimary = url !== null && live?.lane === "primary";
  const primary = view.primary.liveViewUrl === (onPrimary ? url : null) ? view.primary : { ...view.primary, liveViewUrl: onPrimary ? url : null };

  let verify = view.verify;
  let changed = false;
  const next: Record<string, LaneView> = {};
  for (const [fixId, lane] of Object.entries(view.verify)) {
    const wanted = url !== null && live?.lane === "verify" && live.fixId === fixId ? url : null;
    next[fixId] = lane.liveViewUrl === wanted ? lane : { ...lane, liveViewUrl: wanted };
    if (next[fixId] !== lane) changed = true;
  }
  if (changed) verify = next;

  // Same object when nothing moved, so this never forces a re-render on its own.
  return primary === view.primary && verify === view.verify ? view : { ...view, primary, verify };
}

export function applyEvent(view: RunView, event: RunEvent): RunView {
  const key = eventKey(event);
  if (view.seen.has(key)) return view;
  const seen = new Set(view.seen);
  seen.add(key);

  let { primary, verify, fixes, fixOrder } = view;
  if (event.lane === "primary") {
    primary = applyToLane(primary, event);
  } else if (event.type === "fix") {
    // Fix events are full snapshots of the fix: the highest seq wins.
    const id = event.payload.findingId;
    const current = fixes[id];
    if (!current || event.seq > current.seq) fixes = { ...fixes, [id]: event };
    if (!fixOrder.includes(id)) fixOrder = [...fixOrder, id];
  } else if (event.fixId) {
    verify = { ...verify, [event.fixId]: applyToLane(verify[event.fixId] ?? emptyLane(), event) };
  }

  return {
    ...view,
    seen,
    primary,
    verify,
    fixes,
    fixOrder,
    firstTs: view.firstTs === null ? event.ts : Math.min(view.firstTs, event.ts),
    lastTs: view.lastTs === null ? event.ts : Math.max(view.lastTs, event.ts),
  };
}

/** The run row arrives out of band (hello, PATCH). Session links come from it; events own the state. */
export function applyRunRecord(view: RunView, run: RunRecord): RunView {
  const current = view.primary;
  const untouched = current.stateSeq < 0 && current.steps.length === 0;
  const primary: LaneView = {
    ...current,
    sessionId: run.sessionId ?? current.sessionId,
    replayUrl: run.replayUrl ?? current.replayUrl,
    state: untouched ? run.state : current.state,
  };
  return { ...view, run, primary };
}

export function applyHello(view: RunView, hello: StreamHello): RunView {
  const withSource: RunView = { ...view, source: hello.mode };
  return hello.run ? applyRunRecord(withSource, hello.run) : withSource;
}

/** The view after the first `count` events of a snapshot. Drives replay and seeking. */
export function viewFromSnapshot(snapshot: RunSnapshot, count: number): RunView {
  // Keep the session links, but let the replayed events rebuild the state.
  let view = applyRunRecord({ ...emptyRunView(snapshot.run.id), source: snapshot.source }, { ...snapshot.run, state: "idle" });
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
  const p = view.primary;
  const events: RunEvent[] = [...p.steps, ...p.frictions];
  if (p.done) events.push(p.done);
  for (const lane of Object.values(view.verify)) {
    events.push(...lane.steps, ...lane.frictions);
    if (lane.done) events.push(lane.done);
  }
  events.push(...Object.values(view.fixes));
  const run: RunRecord = {
    ...view.run,
    state: p.state,
    outcome: p.done?.payload.outcome ?? view.run.outcome,
    totalSteps: p.done?.payload.totalSteps ?? view.run.totalSteps,
    durationMs: p.done?.payload.durationMs ?? view.run.durationMs,
    sessionId: p.sessionId,
    replayUrl: p.replayUrl,
  };
  return { run, events, source: view.source ?? "live" };
}

export type RunPhase = "waiting" | "running" | "verifying" | "complete";

export interface RunSummary {
  phase: RunPhase;
  label: string;
  tone: "neutral" | "active" | "good" | "bad" | "mixed";
  frictionCount: number;
  stepCount: number;
}

/** Fixes in the order they were proposed. */
export function fixList(view: RunView): FixEvent[] {
  return view.fixOrder.flatMap((id) => (view.fixes[id] ? [view.fixes[id]] : []));
}

export function summarize(view: RunView): RunSummary {
  const p = view.primary;
  const base = { frictionCount: p.frictions.length, stepCount: p.steps.length };
  const fixes = Object.values(view.fixes);
  const pending = fixes.filter((f) => !isVerdictStage(f.payload.stage)).length;

  if (isTerminalState(p.state) && (pending > 0 || view.run?.status === "verifying")) {
    const decided = fixes.length - pending;
    return { ...base, phase: "verifying", tone: "active", label: fixes.length > 0 ? `Verifying fixes · ${decided}/${fixes.length} decided` : "Proposing fixes" };
  }
  if (isTerminalState(p.state)) {
    const verified = fixes.filter((f) => f.payload.stage === "verified" || f.payload.stage === "pr_opened").length;
    const tally = fixes.length > 0 ? ` · ${verified}/${fixes.length} fixes verified` : "";
    if (p.state === "succeeded") return { ...base, phase: "complete", tone: "good", label: `Complete · task succeeded${tally}` };
    if (p.state === "timeout") return { ...base, phase: "complete", tone: "mixed", label: `Complete · timed out${tally}` };
    return { ...base, phase: "complete", tone: "bad", label: `Complete · task failed${tally}` };
  }
  if (p.state === "idle" && p.steps.length === 0) return { ...base, phase: "waiting", tone: "neutral", label: "Starting a session" };
  return { ...base, phase: "running", tone: "active", label: `Running · step ${p.steps.length}` };
}

/** Shown while the live view is still coming up. */
export const AGENT_BLURB = AGENT.description;
