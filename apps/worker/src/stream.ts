/**
 * GET /api/runs/:id/stream
 *
 * Two modes, announced in the first `hello` message:
 *   live     a producer is attached: send the backlog from D1, then follow.
 *   fixture  nobody is producing for this run: replay fixtures/golden-run.json
 *            at one event per 400ms so the frontend is never blocked.
 *
 * Live delivery has a fast path and a safety net:
 *   hub  same-isolate POSTs land on this connection's queue (~150ms latency)
 *   D1   tailed every 1.5-3s, so events still arrive when the producer's POSTs
 *        hit a different isolate than this stream (normal once deployed)
 * Row ids de-duplicate the two paths. Clients also de-duplicate on
 * (personaId, seq), so an overlap on reconnect is harmless.
 *
 * The free plan allows 50 D1 queries per request. A connection recycles itself
 * (`reconnect` event) before it gets there; the client resumes with ?after=.
 */
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  GOLDEN_RUN_ID,
  PERSONA_IDS,
  SSE,
  type PersonaRecord,
  type RunEvent,
  type RunRecord,
  type StreamEnd,
  type StreamHello,
} from "@friction/shared";
import { rebaseGoldenRun } from "@friction/shared/golden";
import { countEvents, getEventsAfter, getPersonas, getRun } from "./db";
import type { AppEnv } from "./env";
import { subscribe, unsubscribe, type HubClient } from "./hub";

const TICK_MS = 150;
const FIXTURE_INTERVAL_MS = 400;
const FIXTURE_GRACE_MS = 3000;
const HEARTBEAT_MS = 15_000;
const POLL_FAST_MS = 1500;
const POLL_SLOW_MS = 3000;
const HUB_ACTIVE_WINDOW_MS = 10_000;
const MAX_D1_QUERIES = 40;
const REWIND_ROWS = 50;
const PAGE_SIZE = 500;

interface FixtureCursor {
  index: number;
  base: number;
}

/** Fixture event ids look like `fx:<index>:<baseTs>` so a reconnect resumes in place. */
function parseFixtureCursor(after: string): FixtureCursor | null {
  const match = /^fx:(\d+):(\d+)$/.exec(after);
  if (!match) return null;
  return { index: Number(match[1]), base: Number(match[2]) };
}

interface Session {
  send: (event: string, data: unknown, id?: string) => Promise<void>;
  comment: (text: string) => Promise<void>;
  sleep: (ms: number) => Promise<unknown>;
  isOpen: () => boolean;
}

export function handleStream(c: Context<AppEnv>): Response {
  const runId = c.req.param("id") ?? "";
  const after = c.req.query("after") ?? c.req.header("Last-Event-ID") ?? "";
  const forceFixture = c.req.query("fixture") === "1";
  const db = c.env.DB;

  return streamSSE(
    c,
    async (stream) => {
      let open = true;
      stream.onAbort(() => {
        open = false;
      });
      const session: Session = {
        isOpen: () => open && !stream.aborted && !stream.closed,
        sleep: (ms) => stream.sleep(ms),
        send: async (event, data, id) => {
          if (!session.isOpen()) return;
          await stream.writeSSE(id === undefined ? { event, data: JSON.stringify(data) } : { event, data: JSON.stringify(data), id });
        },
        comment: async (text) => {
          if (session.isOpen()) await stream.write(`: ${text}\n\n`);
        },
      };

      const fixtureCursor = parseFixtureCursor(after);
      if (runId === GOLDEN_RUN_ID) {
        await playFixture(session, runId, null, fixtureCursor);
        return;
      }

      // Subscribe before touching D1 so nothing can fall between backlog and live.
      const client = subscribe(runId);
      try {
        const budget = { queries: 0 };
        const run = await getRun(db, runId);
        budget.queries += 1;

        if (!run || forceFixture || fixtureCursor) {
          await playFixture(session, runId, run, fixtureCursor);
          return;
        }

        const personas = await getPersonas(db, runId);
        budget.queries += 1;

        if (!(await producerAttached(session, db, runId, personas, client, budget))) {
          await playFixture(session, runId, run, null);
          return;
        }
        await tailLive(session, db, runId, run, personas, client, after, budget);
      } finally {
        unsubscribe(runId, client);
      }
    },
    async (err) => {
      console.error("[stream] failed:", err);
    },
  );
}

/**
 * A producer is attached once it has posted anything for this run. The
 * orchestrator posts idle statuses before it even returns the run id, so for
 * real runs this is true on the first check. Otherwise wait a short grace
 * period, then give up and let the fixture play.
 */
async function producerAttached(
  session: Session,
  db: D1Database,
  runId: string,
  personas: readonly PersonaRecord[],
  client: HubClient,
  budget: { queries: number },
): Promise<boolean> {
  if (client.queue.length > 0) return true;
  if (personas.some((p) => p.sessionId !== null || p.liveViewUrl !== null)) return true;

  const deadline = Date.now() + FIXTURE_GRACE_MS;
  let nextCheck = 0;
  while (session.isOpen()) {
    if (client.queue.length > 0) return true;
    const now = Date.now();
    if (now >= nextCheck) {
      nextCheck = now + 1000;
      budget.queries += 1;
      if ((await countEvents(db, runId)) > 0) return true;
    }
    if (now >= deadline) return false;
    await session.sleep(TICK_MS * 2);
  }
  return false;
}

async function tailLive(
  session: Session,
  db: D1Database,
  runId: string,
  run: RunRecord,
  personas: PersonaRecord[],
  client: HubClient,
  after: string,
  budget: { queries: number },
): Promise<void> {
  const hello: StreamHello = { runId, mode: "live", run, personas };
  await session.send(SSE.hello, hello);

  const sent = new Set<number>();
  const done = new Set<string>();
  const personaJson = new Map(personas.map((p) => [p.personaId, JSON.stringify(p)]));
  // Rewind a little on resume: hub-delivered ids can run ahead of undelivered rows.
  let cursor = Math.max(0, (Number.parseInt(after, 10) || 0) - REWIND_ROWS);

  const emit = async (rowId: number, event: RunEvent): Promise<void> => {
    if (sent.has(rowId)) return;
    sent.add(rowId);
    if (event.type === "done") done.add(event.personaId);
    await session.send(SSE.event, event, String(rowId));
  };

  const emitPersona = async (persona: PersonaRecord): Promise<void> => {
    const json = JSON.stringify(persona);
    if (personaJson.get(persona.personaId) === json) return;
    personaJson.set(persona.personaId, json);
    await session.send(SSE.persona, persona);
  };

  const pullD1 = async (): Promise<void> => {
    for (;;) {
      const rows = await getEventsAfter(db, runId, cursor, PAGE_SIZE);
      budget.queries += 1;
      for (const row of rows) {
        await emit(row.rowId, row.event);
        cursor = Math.max(cursor, row.rowId);
      }
      if (rows.length < PAGE_SIZE) return;
    }
  };

  await pullD1();

  let lastPoll = Date.now();
  let lastBeat = Date.now();
  let lastHubDelivery = 0;
  let personaPollToggle = false;

  while (session.isOpen()) {
    if (done.size >= PERSONA_IDS.length) {
      await pullD1();
      const end: StreamEnd = { reason: "complete" };
      await session.send(SSE.end, end);
      return;
    }
    if (budget.queries >= MAX_D1_QUERIES) {
      await session.send(SSE.reconnect, {});
      return;
    }

    await session.sleep(TICK_MS);

    if (client.queue.length > 0) {
      lastHubDelivery = Date.now();
      for (const message of client.queue.splice(0, client.queue.length)) {
        if (message.kind === "event") await emit(message.rowId, message.event);
        else await emitPersona(message.persona);
      }
    }

    const now = Date.now();
    const interval = now - lastHubDelivery < HUB_ACTIVE_WINDOW_MS ? POLL_SLOW_MS : POLL_FAST_MS;
    if (now - lastPoll >= interval) {
      lastPoll = now;
      await pullD1();

      // Live view URLs arrive via PATCH, not as events. Keep checking (every
      // other poll) until every persona has its session.
      const waitingForSessions = [...personaJson.values()].some((json) => json.includes('"sessionId":null'));
      personaPollToggle = !personaPollToggle;
      if (waitingForSessions && personaPollToggle) {
        budget.queries += 1;
        for (const persona of await getPersonas(db, runId)) await emitPersona(persona);
      }
    }

    if (now - lastBeat >= HEARTBEAT_MS) {
      lastBeat = now;
      await session.comment("ping");
    }
  }
}

async function playFixture(
  session: Session,
  runId: string,
  run: RunRecord | null,
  cursor: FixtureCursor | null,
): Promise<void> {
  const base = cursor?.base ?? Date.now();
  const snapshot = rebaseGoldenRun({ runId, startTs: base, run });

  const hello: StreamHello = {
    runId,
    mode: "fixture",
    run: { ...snapshot.run, status: "running", completedAt: null },
    personas: snapshot.personas.map((p) => ({ ...p, state: "idle", stepCount: 0 })),
  };
  await session.send(SSE.hello, hello);

  const start = cursor ? cursor.index + 1 : 0;
  for (let index = start; index < snapshot.events.length; index++) {
    if (index > start || cursor) await session.sleep(FIXTURE_INTERVAL_MS);
    if (!session.isOpen()) return;
    await session.send(SSE.event, snapshot.events[index], `fx:${index}:${base}`);
  }
  const end: StreamEnd = { reason: "complete" };
  await session.send(SSE.end, end);
}
