/**
 * One hook, three ways to get a run on screen. Each is the fallback of the one
 * before it, so the control room always has something to show:
 *
 *   live     EventSource on the Worker. Reconnects with backoff and resumes
 *            from the last event id. The Worker itself falls back to the
 *            golden fixture when no producer is attached.
 *   replay   (?replay=1) GET /api/runs/:id once, then play it back client-side
 *            with zero live network. Works with the orchestrator dead.
 *   bundled  The Worker is unreachable too: play the copy of the golden run
 *            that is compiled into this bundle. Works with everything dead.
 *
 * All three feed the same reducer (lib/runState), so they render identically.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GOLDEN_RUN_ID,
  SSE,
  compareEvents,
  safeParseEvent,
  type LiveViewResponse,
  type RunRecord,
  type RunSnapshot,
  type StreamHello,
} from "@friction/shared";
import { rebaseGoldenRun } from "@friction/shared/golden";
import { api } from "../lib/api";
import {
  applyEvent,
  applyHello,
  applyLiveView,
  applyRunRecord,
  emptyRunView,
  summarize,
  viewFromSnapshot,
  type RunView,
} from "../lib/runState";

export type Connection = "idle" | "connecting" | "open" | "reconnecting" | "ended" | "offline" | "local";

/** Where the data on screen is coming from. */
export type Origin = "live" | "fixture" | "replay" | "bundled";

export interface ReplayControls {
  playing: boolean;
  speed: number;
  index: number;
  total: number;
  atEnd: boolean;
  play: () => void;
  pause: () => void;
  restart: () => void;
  setSpeed: (speed: number) => void;
  seek: (index: number) => void;
}

export interface RunStream {
  view: RunView;
  origin: Origin | null;
  connection: Connection;
  /** Human-readable explanation whenever a fallback kicked in. */
  notice: string | null;
  elapsedMs: number | null;
  /** Present whenever playback is client-side. */
  replay: ReplayControls | null;
  /** The full run when we have it (replay modes); feeds the offline report. */
  snapshot: RunSnapshot | null;
}

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

/** Dead air between events is capped so a slow run still replays briskly. */
const MAX_GAP_MS = 2500;
/** Give up on the Worker after this many failed connects with nothing received. */
const MAX_COLD_FAILURES = 3;
const BACKOFF_BASE_MS = 400;
const BACKOFF_MAX_MS = 5000;
/** Events arriving within this window share one render. */
const FLUSH_MS = 40;
/** How often the open browser session is re-checked. Mostly a liveness check; see useLiveView. */
const LIVE_VIEW_POLL_MS = 20_000;

/* -------------------------------------------------------------------- live */

interface LiveState {
  view: RunView;
  connection: Connection;
  gaveUp: boolean;
}

function useLiveStream(runId: string | null, enabled: boolean): LiveState {
  const [view, setView] = useState<RunView>(() => emptyRunView(runId ?? ""));
  const [connection, setConnection] = useState<Connection>("idle");
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!enabled || !runId) {
      setConnection("idle");
      return;
    }
    setView(emptyRunView(runId));
    setConnection("connecting");
    setGaveUp(false);

    let source: EventSource | null = null;
    let disposed = false;
    let ended = false;
    let lastId = "";
    let failures = 0;
    let received = 0;
    let retryTimer: number | undefined;

    // A reconnect replays a backlog in one burst. Fold each burst into a single render.
    // Deliberately a timer, not requestAnimationFrame: rAF stops firing when the tab is
    // backgrounded or occluded, which would freeze the control room mid-run.
    let pending: Array<(view: RunView) => RunView> = [];
    let flushTimer: number | undefined;
    const flush = (): void => {
      flushTimer = undefined;
      const operations = pending;
      pending = [];
      setView((current) => operations.reduce((acc, operation) => operation(acc), current));
    };
    const enqueue = (operation: (view: RunView) => RunView): void => {
      pending.push(operation);
      if (flushTimer === undefined) flushTimer = window.setTimeout(flush, FLUSH_MS);
    };

    const parse = <T,>(message: Event): T | null => {
      try {
        return JSON.parse((message as MessageEvent<string>).data) as T;
      } catch {
        return null;
      }
    };

    const connect = (): void => {
      if (disposed) return;
      source = new EventSource(api.streamUrl(runId, lastId));

      source.addEventListener(SSE.hello, (message) => {
        const hello = parse<StreamHello>(message);
        if (!hello) return;
        failures = 0;
        received += 1;
        setConnection("open");
        enqueue((current) => applyHello(current, hello));
      });

      source.addEventListener(SSE.event, (message) => {
        const id = (message as MessageEvent<string>).lastEventId;
        if (id) lastId = id;
        const parsed = safeParseEvent(parse<unknown>(message));
        if (!parsed.success) {
          console.warn("[stream] dropped malformed event:", parsed.error);
          return;
        }
        received += 1;
        enqueue((current) => applyEvent(current, parsed.data));
      });

      source.addEventListener(SSE.run, (message) => {
        const record = parse<RunRecord>(message);
        if (record) enqueue((current) => applyRunRecord(current, record));
      });

      // The Worker recycles long connections to stay inside its D1 budget.
      source.addEventListener(SSE.reconnect, () => {
        source?.close();
        connect();
      });

      source.addEventListener(SSE.end, () => {
        ended = true;
        source?.close();
        setConnection("ended");
      });

      source.onerror = () => {
        source?.close();
        if (disposed || ended) return;
        failures += 1;
        if (received === 0 && failures >= MAX_COLD_FAILURES) {
          setConnection("offline");
          setGaveUp(true);
          return;
        }
        setConnection("reconnecting");
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      source?.close();
      window.clearTimeout(retryTimer);
      window.clearTimeout(flushTimer);
    };
  }, [runId, enabled]);

  return { view, connection, gaveUp };
}

/* ------------------------------------------------------------------ replay */

interface ReplayState {
  snapshot: RunSnapshot | null;
  bundled: boolean;
  loading: boolean;
  view: RunView | null;
  controls: ReplayControls | null;
}

function useReplay(runId: string | null, enabled: boolean, bundledOnly: boolean): ReplayState {
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [bundled, setBundled] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(2);

  // The only network call replay ever makes. Everything after it is local.
  useEffect(() => {
    if (!enabled || !runId) return;
    let cancelled = false;
    setSnapshot(null);
    setIndex(0);
    setPlaying(true);

    const useBundled = (): void => {
      if (cancelled) return;
      setBundled(true);
      setSnapshot(rebaseGoldenRun({ runId }));
    };

    if (bundledOnly) {
      useBundled();
    } else {
      api
        .getSnapshot(runId)
        .then((loaded) => {
          if (cancelled) return;
          setBundled(false);
          setSnapshot({ ...loaded, events: [...loaded.events].sort(compareEvents) });
        })
        .catch(useBundled);
    }
    return () => {
      cancelled = true;
    };
  }, [runId, enabled, bundledOnly]);

  const total = snapshot?.events.length ?? 0;

  useEffect(() => {
    if (!enabled || !snapshot || !playing) return;
    if (index >= total) {
      setPlaying(false);
      return;
    }
    const previous = snapshot.events[index - 1];
    const next = snapshot.events[index];
    const gap = previous && next ? Math.min(Math.max(next.ts - previous.ts, 0), MAX_GAP_MS) : 250;
    const timer = window.setTimeout(() => setIndex((current) => current + 1), Math.max(16, gap / speed));
    return () => window.clearTimeout(timer);
  }, [enabled, snapshot, playing, index, speed, total]);

  const view = useMemo(() => (snapshot ? viewFromSnapshot(snapshot, index) : null), [snapshot, index]);

  const play = useCallback(() => {
    setIndex((current) => (current >= total ? 0 : current));
    setPlaying(true);
  }, [total]);
  const pause = useCallback(() => setPlaying(false), []);
  const restart = useCallback(() => {
    setIndex(0);
    setPlaying(true);
  }, []);
  const seek = useCallback((target: number) => setIndex(Math.max(0, Math.min(total, Math.round(target)))), [total]);

  const controls: ReplayControls | null = snapshot
    ? { playing, speed, index, total, atEnd: index >= total, play, pause, restart, setSpeed, seek }
    : null;

  return { snapshot, bundled, loading: enabled && !snapshot, view, controls };
}

/* --------------------------------------------------------------- live view */

/**
 * The Browserbase live view URL, asked for rather than remembered.
 *
 * It is signed, pinned to one page target and only valid while that session is
 * open, so the orchestrator mints it on demand. The poll's real job is liveness:
 * it is how the UI finds out a session has ENDED, so the iframe comes down
 * instead of sitting there showing DevTools' "connection was closed".
 *
 * The URL is kept for as long as the session id is unchanged. Re-minting would
 * hand back a different signature every poll, and the iframe is keyed on the
 * URL, so it would reload every few seconds.
 */
function useLiveView(runId: string | null, active: boolean): LiveViewResponse | null {
  const [live, setLive] = useState<LiveViewResponse | null>(null);

  useEffect(() => {
    if (!active || !runId) {
      setLive(null);
      return;
    }
    let cancelled = false;
    const keepIfSameSession = (next: LiveViewResponse | null) => (current: LiveViewResponse | null) =>
      current && next && current.sessionId === next.sessionId ? current : next;
    const poll = (): void => {
      api
        .liveView(runId)
        .then((next) => {
          if (!cancelled) setLive(keepIfSameSession(next));
        })
        // Orchestrator down or unreachable: no live view, fall back to the step screenshots.
        .catch(() => {
          if (!cancelled) setLive(null);
        });
    };
    poll();
    const timer = window.setInterval(poll, LIVE_VIEW_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runId, active]);

  return live;
}

/* ------------------------------------------------------------------- clock */

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/* -------------------------------------------------------------------- hook */

export function useRunStream(runId: string | null, options: { replay: boolean }): RunStream {
  const live = useLiveStream(runId, !options.replay);
  const replaying = options.replay || live.gaveUp;
  const replay = useReplay(runId, replaying, live.gaveUp);

  const view = replaying ? (replay.view ?? emptyRunView(runId ?? "")) : live.view;
  const phase = summarize(view).phase;

  let origin: Origin | null = null;
  if (replaying) origin = replay.snapshot ? (replay.bundled ? "bundled" : "replay") : null;
  else if (view.source) origin = view.source;

  // Only a genuinely live, unfinished run can have a browser session open.
  const liveView = useLiveView(runId, origin === "live" && phase !== "complete");

  // Wall clock only for genuinely live runs; fixture and replay time is event time.
  const wallClock = origin === "live" && phase !== "complete";
  const now = useNow(wallClock);
  const start = origin === "live" ? (view.run?.createdAt ?? view.firstTs) : view.firstTs;
  let elapsedMs: number | null = null;
  if (start !== null) elapsedMs = Math.max(0, (wallClock ? now : (view.lastTs ?? start)) - start);

  let notice: string | null = null;
  if (origin === "bundled") {
    notice = options.replay
      ? "Worker unreachable, so this is the golden run bundled into the app. Nothing here needs a network."
      : "Could not reach the Worker, so this is the golden run bundled into the app. Nothing here needs a network.";
  } else if (origin === "fixture" && runId !== GOLDEN_RUN_ID) {
    notice = "No live producer is attached to this run, so the Worker is streaming the golden fixture.";
  } else if (origin === "replay" && replay.snapshot?.source === "fixture" && runId !== GOLDEN_RUN_ID) {
    notice = "This run has no recorded events, so the replay shows the golden fixture.";
  }

  let connection: Connection = live.connection;
  if (replaying) connection = replay.loading ? "connecting" : "local";

  return {
    view: applyLiveView(view, liveView),
    origin,
    connection,
    notice,
    elapsedMs,
    replay: replaying ? replay.controls : null,
    snapshot: replaying ? replay.snapshot : null,
  };
}
