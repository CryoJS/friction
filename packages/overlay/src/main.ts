/**
 * The bookmarklet entry point.
 *
 * This file becomes the whole `javascript:` URL (via build.mjs), so it is the
 * thing that runs when a user, standing on THEIR OWN site, clicks the
 * bookmark. Everything else in this package is machinery `main()` drives:
 * fetch the scan, mount it, or explain clearly why it couldn't.
 *
 * Requirement numbers below track task-10-brief.md's numbered list for
 * main.ts so each one has a visible, checkable home.
 */
import type { AnnotationsResponse } from "@friction/shared";
import { OVERLAY_VERSION } from "@friction/shared";
import { mountOverlay, OVERLAY_ROOT_ID } from "./render";
import { addStalenessNotice, mountMessage, registerSentinel, removeExistingRoot } from "./shell";

// Injected by esbuild's `define` in build.mjs. Never read at runtime from
// process.env -- there is no Node process in the page this bundle runs on.
declare const WORKER_ORIGIN: string;
// Same mechanism, for the 404 link: WORKER_ORIGIN is the API, not a page a
// human should land on (it serves raw JSON at "/"). This is the control
// room's own origin, set properly by whatever deploys this build; the
// localhost:5173 default matches apps/control-room's dev port.
declare const CONTROL_ROOM_ORIGIN: string;

const ANNOTATIONS_KEY = "__friction_annotations";
const FOCUS_KEY = "__friction_focus";

declare global {
  interface Window {
    // Minor fix (fix round 1): this bundle has no module state that
    // survives between two clicks -- a javascript: bookmarklet is a fresh
    // top-level script evaluation every time it runs, so a plain `let`
    // here would reset on every click and protect nothing. Only something
    // hung off `window` (like __frictionOverlay, declared in shell.ts)
    // persists between separate clicks, which is exactly the gap this
    // closes: window.__frictionOverlay isn't written until a mount
    // finishes, so two clicks before the first fetch settles both see it
    // unset and both proceed, racing two fetches into two mounts.
    __frictionRequestInFlight?: boolean;
  }
}

/** The sessionStorage payload shape, host-tagged so a leftover value from a
 * different navigation within the same tab is never mistaken for this one's.
 * (sessionStorage is already origin-scoped, but a bare `location.hostname`
 * check costs nothing and is what the brief asks for explicitly.) */
interface StoredAnnotations {
  host: string;
  response: AnnotationsResponse;
}

/** Every sessionStorage touch is wrapped: it throws outright in some private
 * browsing modes, and a bookmarklet that dies on a getItem() call would be a
 * much worse failure than just re-fetching. */
function readCachedResponse(host: string): AnnotationsResponse | null {
  try {
    const raw = sessionStorage.getItem(ANNOTATIONS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAnnotations;
    if (parsed.host !== host) return null;
    return parsed.response;
  } catch {
    return null;
  }
}

function writeCachedResponse(host: string, response: AnnotationsResponse): void {
  try {
    const payload: StoredAnnotations = { host, response };
    sessionStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled or full: the overlay still mounts from the response
    // already in hand, it just fetches again next click.
  }
}

function readFocusTarget(): string | null {
  try {
    return sessionStorage.getItem(FOCUS_KEY);
  } catch {
    return null;
  }
}

function clearFocusTarget(): void {
  try {
    sessionStorage.removeItem(FOCUS_KEY);
  } catch {
    // nothing to clean up if storage is unavailable in the first place
  }
}

/**
 * Fix round 2, part (c): a response is only ever cached AFTER it has
 * mounted successfully (see main()'s success branch and the cached-response
 * branch below). If a cached response later fails to mount anyway, the
 * cache must be cleared here rather than left in place -- otherwise a single
 * bad response makes the bookmarklet permanently broken for this host until
 * sessionStorage is cleared by hand, since every future click would just
 * read the same poisoned entry and crash the same way.
 */
function clearCachedResponse(): void {
  try {
    sessionStorage.removeItem(ANNOTATIONS_KEY);
  } catch {
    // nothing to clean up if storage is unavailable in the first place
  }
}

function finish(response: AnnotationsResponse): void {
  // Fix round 2, part (a): see removeExistingRoot()'s doc comment. mountOverlay
  // itself can throw partway through (a malformed anchor.tag reaching
  // resolveAnchor, before round 2's resolve.ts fix; kept here too as a
  // second layer, since "trust the caller cleaned up" is exactly the
  // assumption that caused the orphan-root defect).
  removeExistingRoot();
  const handle = mountOverlay(response, document);
  registerSentinel(handle.destroy);

  // Requirement 6.
  if (response.overlayVersion > OVERLAY_VERSION) {
    addStalenessNotice();
  }

  // Requirement 7 needs no code here: render.ts's panel always renders, even
  // when every finding is unlocated or there are none at all. The one way to
  // defeat that guarantee would be skipping this call, so this function
  // never does.

  // Requirement 8.
  const focusId = readFocusTarget();
  if (focusId) {
    handle.focusFinding(focusId);
    clearFocusTarget();
  }
}

/**
 * Fix round 1, Finding 1: finish() calls into render.ts's mountOverlay with
 * data this bundle does not control the shape of (a parsed HTTP response
 * body, or whatever got round-tripped through sessionStorage). If that
 * throws, an unguarded call here would leave the user with NOTHING -- no
 * markers, no panel, no error -- which is worse than the empty-overlay case
 * requirement 7 exists to prevent: at least an empty overlay says the
 * bookmarklet ran. This is the backstop for both the cached and the
 * freshly-fetched success paths.
 *
 * Returns whether the mount actually succeeded (fix round 2, part (c)):
 * callers use this to decide whether the response is safe to cache -- a
 * response that crashed the mount must never be written to sessionStorage,
 * or every future click reads back the same poison and crashes the same way.
 */
function mountResponseSafely(response: AnnotationsResponse): boolean {
  try {
    finish(response);
    return true;
  } catch (err) {
    registerSentinel(
      mountMessage(`Friction couldn't display this scan: ${err instanceof Error ? err.message : String(err)}`).destroy,
    );
    return false;
  }
}

async function main(): Promise<void> {
  // Requirement 1: toggle off if an overlay (from this bundle or an older
  // one) is already mounted. Deleting the global before returning is what
  // lets a second click re-mount cleanly instead of toggling forever.
  const existing = window.__frictionOverlay;
  if (existing) {
    existing.destroy();
    delete window.__frictionOverlay;
    return;
  }

  const host = location.hostname;

  // Requirement 2.
  const cached = readCachedResponse(host);
  if (cached) {
    // Fix round 2, part (c): a cached response was only ever written after a
    // previous successful mount, but if it fails to mount THIS time anyway
    // (a bug, a state change since it was cached), clear it rather than
    // leave a permanently-poisoned entry every future click will keep
    // hitting.
    if (!mountResponseSafely(cached)) {
      clearCachedResponse();
    }
    return;
  }

  // Minor fix (fix round 1): a second click while the first request is still
  // in flight is a no-op rather than a second fetch racing the first --
  // window.__frictionOverlay above only catches the SETTLED case, since it
  // is not written until a mount finishes. This flag lives on `window`,
  // not as a local variable, because a bookmarklet click is a fresh script
  // evaluation every time -- nothing module-scoped survives to see it.
  if (window.__frictionRequestInFlight) return;
  window.__frictionRequestInFlight = true;

  try {
    // Requirement 3.
    let res: Response;
    try {
      res = await fetch(`${WORKER_ORIGIN}/api/annotations?host=${encodeURIComponent(host)}`);
    } catch (err) {
      // Requirement 4, network-failure branch. Fix round 1, Finding 3: the
      // Fetch spec rejects with a TypeError for ANY network-level failure --
      // a CSP connect-src block, but equally a dead Worker, no DNS, being
      // offline, or an ordinary CORS failure. JavaScript cannot distinguish
      // these, so the copy leads with what's certain and hedges the rest,
      // rather than asserting CSP as fact. navigator.onLine gets the one
      // case that CAN be told apart for certain.
      if (err instanceof TypeError) {
        if (navigator.onLine === false) {
          registerSentinel(mountMessage("You appear to be offline.").destroy);
          return;
        }
        // Task 12: this branch now has an actual offline bookmarklet to
        // point at, but only as far as the control room -- this fetch was
        // BY HOST (see the URL above), never by scan id, so this module
        // never learns which scan it would have shown even on success, and
        // has no way to deep-link straight to an offline bookmarklet built
        // for one. Naming the control room's origin (already known via
        // CONTROL_ROOM_ORIGIN, same as the 404 branch below) is as far as
        // this can go: the user opens it, finds their scan, and drags the
        // offline link from there themselves.
        registerSentinel(
          mountMessage(
            `Friction couldn't be reached (${WORKER_ORIGIN}). This is usually the site's Content-Security-Policy blocking the request, but it can also mean the Friction worker is unreachable. If it's the site's policy, use the offline bookmarklet instead -- it pastes the scan data in directly and needs no network request.`,
            { href: CONTROL_ROOM_ORIGIN, text: "Open the control room to get it" },
          ).destroy,
        );
        return;
      }
      registerSentinel(mountMessage(`Could not reach Friction: ${err instanceof Error ? err.message : String(err)}`).destroy);
      return;
    }

    // Requirement 4, 404 branch.
    if (res.status === 404) {
      registerSentinel(
        mountMessage(`No Friction scan for ${host} yet.`, { href: CONTROL_ROOM_ORIGIN, text: "Open the control room" })
          .destroy,
      );
      return;
    }

    // Requirement 4, any other non-OK status.
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { error?: string };
        detail = body.error ?? "";
      } catch {
        // Body wasn't JSON (or wasn't readable) -- report the bare status.
      }
      registerSentinel(mountMessage(`Friction request failed (${res.status})${detail ? `: ${detail}` : ""}.`).destroy);
      return;
    }

    // Fix round 1, Finding 1: unlike the branch above, this parse was
    // previously unguarded. A malformed or truncated 200 body (a corporate
    // proxy, a compressing middlebox, a CDN edge glitch -- all real on a
    // third-party network) would throw here, become an unhandled rejection
    // (main() was invoked as bare `void main()`), and leave the user with
    // nothing: no markers, no panel, no error. That is worse than the empty
    // overlay requirement 7 exists to prevent.
    try {
      const response = (await res.json()) as AnnotationsResponse;
      // Requirement 5, and fix round 2, part (c): the cache write moved to
      // AFTER a successful mount. Writing it unconditionally (the original
      // order) meant a payload that crashed mountOverlay got written to
      // sessionStorage anyway -- every later click would then read that
      // same cached entry, skip the network entirely, hit the same crash,
      // and never get a chance to fetch a corrected response.
      if (mountResponseSafely(response)) {
        writeCachedResponse(host, response);
      }
    } catch (err) {
      registerSentinel(
        mountMessage(`Friction's response couldn't be read: ${err instanceof Error ? err.message : String(err)}`).destroy,
      );
    }
  } finally {
    window.__frictionRequestInFlight = false;
  }
}

// Fix round 1, Finding 1 (belt and braces): every failure this module knows
// how to name is already handled above with its own mountMessage() call.
// This is the backstop for one it doesn't -- a truly unexpected throw
// anywhere in main() (a bug, not a modeled failure mode) still must not
// leave the user looking at nothing. Only mounts if nothing else already
// did, so it never stacks a second panel on top of a real one.
main().catch((err: unknown) => {
  if (!document.getElementById(OVERLAY_ROOT_ID)) {
    registerSentinel(
      mountMessage(`Friction hit an unexpected error: ${err instanceof Error ? err.message : String(err)}`).destroy,
    );
  }
});
