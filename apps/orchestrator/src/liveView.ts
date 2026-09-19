/**
 * The live view URL, minted when it is about to be looked at.
 *
 * Browserbase's `debuggerFullscreenUrl` is not a page address: it is a signed,
 * time-limited URL pinned to one page target of one live session, and the
 * iframe that loads it is a real DevTools frontend holding a WebSocket. Minting
 * it once at session create, storing it, and rendering it minutes later gives
 * DevTools a socket it cannot open: "Debugging connection was closed".
 *
 * So nothing stores it. Every open session registers itself here while it is
 * open, and GET /runs/:runId/live-view mints a fresh URL for whatever is open
 * at that instant. No open session means a null answer, which is how the
 * control room learns to drop the iframe instead of showing a dead one.
 */
import Browserbase from "@browserbasehq/sdk";
import type { Lane, LiveViewResponse } from "@friction/shared";
import type { Config } from "./config";
import { errorMessage, log, withTimeout } from "./util";

export interface OpenSession {
  sessionId: string;
  lane: Lane;
  /** Verify lane: the finding whose fix this session is testing. */
  fixId: string | null;
}

/** runId -> the one browser session open for that run. A run opens them strictly in sequence. */
const openSessions = new Map<string, OpenSession>();

export const NO_LIVE_VIEW: LiveViewResponse = { sessionId: null, lane: null, fixId: null, liveViewUrl: null };

export function registerSession(runId: string, session: OpenSession): void {
  openSessions.set(runId, session);
}

/**
 * Only clears the entry if it is still this session's: a run's next session may
 * already have registered by the time the previous one finishes closing.
 */
export function releaseSession(runId: string, sessionId: string): void {
  if (openSessions.get(runId)?.sessionId === sessionId) openSessions.delete(runId);
}

export async function mintLiveView(config: Config, runId: string): Promise<LiveViewResponse> {
  const open = openSessions.get(runId);
  if (!open) return NO_LIVE_VIEW;
  const apiKey = config.browserbaseApiKey;
  if (!apiKey) return NO_LIVE_VIEW;

  try {
    const bb = new Browserbase({ apiKey, maxRetries: 1, timeout: 10_000 });
    const urls = await withTimeout(bb.sessions.debug(open.sessionId), 10_000, "live view URL");
    // pages[0] is the tab the agent drives. The session-level URL is the fallback
    // for the moment before the first page exists.
    const liveViewUrl = urls.pages[0]?.debuggerFullscreenUrl ?? urls.debuggerFullscreenUrl ?? null;
    return { sessionId: open.sessionId, lane: open.lane, fixId: open.fixId, liveViewUrl };
  } catch (err) {
    // The session ended between the step that registered it and this call: normal, not an error.
    log("live-view", `${runId}: no live view for session ${open.sessionId}: ${errorMessage(err)}`);
    return NO_LIVE_VIEW;
  }
}
