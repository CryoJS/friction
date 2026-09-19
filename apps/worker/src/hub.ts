/**
 * In-memory fan-out: a Map of connected SSE clients per run id.
 *
 * Workers forbid one request from touching another request's I/O objects, so
 * POST /events must never write to an SSE response stream directly. Instead it
 * pushes plain messages onto each client's queue, and every SSE connection
 * drains its own queue on its own timer (see stream.ts). Only plain data
 * crosses the request boundary.
 *
 * This Map lives in one isolate. In production the producer's POST can land on
 * a different isolate than the viewer's stream; stream.ts also tails D1, so
 * delivery never depends on this fast path. No Durable Object needed.
 */
import type { PersonaRecord, RunEvent } from "@friction/shared";

export type HubMessage =
  | { kind: "event"; rowId: number; event: RunEvent }
  | { kind: "persona"; persona: PersonaRecord };

export interface HubClient {
  queue: HubMessage[];
}

const MAX_QUEUE = 2000;
const clients = new Map<string, Set<HubClient>>();

export function subscribe(runId: string): HubClient {
  const client: HubClient = { queue: [] };
  let set = clients.get(runId);
  if (!set) {
    set = new Set();
    clients.set(runId, set);
  }
  set.add(client);
  return client;
}

export function unsubscribe(runId: string, client: HubClient): void {
  const set = clients.get(runId);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) clients.delete(runId);
}

/** Returns how many connected clients received the message. */
export function broadcast(runId: string, message: HubMessage): number {
  const set = clients.get(runId);
  if (!set) return 0;
  for (const client of set) {
    // A stalled client must not grow without bound; D1 tailing recovers the gap.
    if (client.queue.length >= MAX_QUEUE) client.queue.shift();
    client.queue.push(message);
  }
  return set.size;
}

export function clientCount(runId: string): number {
  return clients.get(runId)?.size ?? 0;
}
