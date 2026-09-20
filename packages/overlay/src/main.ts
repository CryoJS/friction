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
import { mountOverlay, OVERLAY_ROOT_ID, type OverlayHandle } from "./render";
import { CSS } from "./styles";

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

/** What the versioned global sentinel actually stores. See requirement 1. */
interface OverlaySentinel {
  version: number;
  destroy(): void;
}

declare global {
  interface Window {
    __frictionOverlay?: OverlaySentinel;
    // Minor fix (fix round 1): this bundle has no module state that
    // survives between two clicks -- a javascript: bookmarklet is a fresh
    // top-level script evaluation every time it runs, so a plain `let`
    // here would reset on every click and protect nothing. Only something
    // hung off `window` (like __frictionOverlay itself) persists between
    // separate clicks, which is exactly the gap this closes: window.
    // __frictionOverlay isn't written until a mount finishes, so two
    // clicks before the first fetch settles both see it unset and both
    // proceed, racing two fetches into two mounts.
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

function registerSentinel(destroy: () => void): void {
  window.__frictionOverlay = { version: OVERLAY_VERSION, destroy };
}

/**
 * Mounts a message-only panel for a state that has no findings at all -- a
 * network failure (which may or may not be a CSP block; see main()'s catch),
 * a 404, an unparseable response body, or an unexpected error. Reuses the
 * overlay's shadow-root shell and stylesheet (styles.ts) so it looks like the
 * same product, but does not go through render.ts's mountOverlay, which is
 * built around a real AnnotationsResponse.
 */
function mountMessage(message: string, link?: { href: string; text: string }): OverlayHandle {
  const root = document.createElement("div");
  root.id = OVERLAY_ROOT_ID;
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.margin = "0";
  root.style.pointerEvents = "none";
  const shadow = root.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = CSS;
  shadow.appendChild(styleEl);

  const panel = document.createElement("div");
  panel.className = "panel";

  const head = document.createElement("div");
  head.className = "panel-head";
  const label = document.createElement("span");
  label.textContent = "Friction overlay";
  head.appendChild(label);
  panel.appendChild(head);

  const body = document.createElement("div");
  body.className = "panel-body";
  const note = document.createElement("p");
  note.className = "empty-note";
  note.textContent = message;
  body.appendChild(note);

  if (link) {
    const a = document.createElement("a");
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = link.text;
    body.appendChild(a);
  }

  panel.appendChild(body);
  shadow.appendChild(panel);
  document.body.appendChild(root);

  return {
    destroy(): void {
      root.remove();
    },
    // Nothing is ever located in a message-only panel, so focusing is a no-op
    // rather than an error -- see requirement 8's caller, which does not know
    // in advance whether it got a real overlay or a message panel back.
    focusFinding(): void {},
  };
}

/**
 * Adds the "your overlay is out of date" line into an already-mounted
 * findings panel (requirement 6). render.ts's OverlayHandle exposes only
 * destroy()/focusFinding(), so this reaches the shadow root directly by id --
 * it is `mode: "open"`, so this is a supported read, not a hack around the
 * encapsulation render.ts actually cares about (which is keeping the host
 * page OUT, not keeping this module out).
 */
function addStalenessNotice(): void {
  const shadow = document.getElementById(OVERLAY_ROOT_ID)?.shadowRoot;
  const body = shadow?.querySelector(".panel-body");
  if (!body) return;
  const notice = document.createElement("p");
  notice.className = "empty-note";
  notice.textContent = "This overlay is out of date. Re-drag the bookmarklet from the control room to get the latest version.";
  body.insertBefore(notice, body.firstChild);
}

function finish(response: AnnotationsResponse): void {
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
 */
function mountResponseSafely(response: AnnotationsResponse): void {
  try {
    finish(response);
  } catch (err) {
    registerSentinel(
      mountMessage(`Friction couldn't display this scan: ${err instanceof Error ? err.message : String(err)}`).destroy,
    );
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
    mountResponseSafely(cached);
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
        registerSentinel(
          mountMessage(
            `Friction couldn't be reached (${WORKER_ORIGIN}). This is usually the site's Content-Security-Policy blocking the request, but it can also mean the Friction worker is unreachable. If it's the site's policy, use the offline bookmarklet instead -- it pastes the scan data in directly and needs no network request.`,
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
      // Requirement 5.
      writeCachedResponse(host, response);
      mountResponseSafely(response);
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
