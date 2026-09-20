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
 * fetch failure, a CSP block, or a 404. Reuses the overlay's shadow-root
 * shell and stylesheet (styles.ts) so it looks like the same product, but
 * does not go through render.ts's mountOverlay, which is built around a real
 * AnnotationsResponse.
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
    finish(cached);
    return;
  }

  // Requirement 3.
  let res: Response;
  try {
    res = await fetch(`${WORKER_ORIGIN}/api/annotations?host=${encodeURIComponent(host)}`);
  } catch (err) {
    // Requirement 4, CSP branch: a fetch() rejection whose error is a
    // TypeError means the browser never got to send the request at all --
    // on a real page the overwhelmingly common cause is the site's
    // connect-src CSP refusing WORKER_ORIGIN. This is NOT "no scan found":
    // a scan may well exist, the request just never reached the Worker. Do
    // not conflate the two -- see requirement 4's CSP branch.
    if (err instanceof TypeError) {
      registerSentinel(
        mountMessage(
          `This site's Content-Security-Policy blocked the request to Friction (${WORKER_ORIGIN}), so this bookmarklet can't tell whether a scan exists. Use the offline bookmarklet instead -- it pastes the scan data in directly and needs no network request.`,
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
      mountMessage(`No Friction scan for ${host} yet.`, { href: WORKER_ORIGIN, text: "Open Friction to run a scan" }).destroy,
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

  const response = (await res.json()) as AnnotationsResponse;
  // Requirement 5.
  writeCachedResponse(host, response);
  finish(response);
}

void main();
