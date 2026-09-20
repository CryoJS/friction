/**
 * Shared shell between the two bookmarklet entry points: main.ts (the online
 * bookmarklet) and offline.ts (Task 12's network-free variant). Both are
 * built as SEPARATE esbuild entry points (see build.mjs) and end up as two
 * independent IIFEs -- importing this module from both costs nothing against
 * that "two separate artifacts" requirement, since esbuild bundles each
 * entry point's own copy of whatever it imports. What this removes is the
 * SOURCE-level duplication that previously kept the two bundles' sentinel
 * shape and message panel in sync only by a comment saying they must agree.
 *
 * Genuinely entry-specific behaviour is NOT here: the fetch, the
 * sessionStorage cache, and the CSP/404 panels stay in main.ts; the
 * `window.__FRICTION_DATA__` read stays in offline.ts.
 */
import { OVERLAY_VERSION } from "@friction/shared";
import { OVERLAY_ROOT_ID, type OverlayHandle } from "./render";
import { CSS } from "./styles";

/**
 * What the versioned global sentinel actually stores. Declared exactly once:
 * either bookmarklet's sentinel is a valid "already mounted" signal for the
 * OTHER one (each entry point's toggle-off branch reads window.
 * __frictionOverlay without caring which bundle wrote it), so a single
 * shared shape is load-bearing, not just tidiness.
 */
export interface OverlaySentinel {
  version: number;
  destroy(): void;
}

declare global {
  interface Window {
    __frictionOverlay?: OverlaySentinel;
  }
}

export function registerSentinel(destroy: () => void): void {
  window.__frictionOverlay = { version: OVERLAY_VERSION, destroy };
}

/**
 * Fix round 2, part (a): removes any `#__friction-root` already in the
 * document before a new one is appended. Nothing may assume the previous
 * mount either never started or fully finished -- render.ts's mountOverlay
 * appends its root to doc.body BEFORE it finishes resolving/mounting every
 * finding, so a throw partway through (e.g. resolve.ts hitting a malformed
 * anchor) leaves a first, broken root already in the DOM when a later
 * mountMessage() call tries to mount a second one under the same id.
 * document.getElementById only ever returns the FIRST match, so a second
 * root sharing that id would be an orphan: invisible to future lookups,
 * unremovable by any destroy() this module hands out, and still carrying
 * whatever live listeners it managed to attach before it threw. Called at
 * the top of every function that appends a `#__friction-root` element, so
 * mounting is idempotent at the DOM level regardless of why the previous
 * attempt didn't finish cleanly.
 */
export function removeExistingRoot(): void {
  document.getElementById(OVERLAY_ROOT_ID)?.remove();
}

/**
 * Mounts a message-only panel for a state that has no findings at all -- a
 * network failure (which may or may not be a CSP block; see main.ts's
 * catch), a 404, an unparseable response body, an unexpected error, or (in
 * offline.ts) a missing/malformed inline payload. Reuses the overlay's
 * shadow-root shell and stylesheet (styles.ts) so it looks like the same
 * product, but does not go through render.ts's mountOverlay, which is built
 * around a real AnnotationsResponse.
 *
 * `link` is optional: offline.ts never passes one, because it has nowhere
 * useful to send the user -- it doesn't know the control room's origin, and
 * was never told a scan id beyond whatever it already failed to read.
 */
export function mountMessage(message: string, link?: { href: string; text: string }): OverlayHandle {
  removeExistingRoot();
  const root = document.createElement("div");
  root.id = OVERLAY_ROOT_ID;
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.margin = "0";
  root.style.pointerEvents = "none";
  // See the matching comment in render.ts's mountOverlay: without its own
  // z-index, this root is just an ordinary z-index:auto positioned element,
  // and a host element with any explicit z-index of its own can still paint
  // over it.
  root.style.zIndex = "2147483647";
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
    // Nothing is ever located in a message-only panel, so focusing is a
    // no-op rather than an error -- callers do not know in advance whether
    // they got a real overlay or a message panel back.
    focusFinding(): void {},
  };
}

/**
 * Adds the "your overlay is out of date" line into an already-mounted
 * findings panel. render.ts's OverlayHandle exposes only
 * destroy()/focusFinding(), so this reaches the shadow root directly by id --
 * it is `mode: "open"`, so this is a supported read, not a hack around the
 * encapsulation render.ts actually cares about (which is keeping the host
 * page OUT, not keeping this module out).
 */
export function addStalenessNotice(): void {
  const shadow = document.getElementById(OVERLAY_ROOT_ID)?.shadowRoot;
  const body = shadow?.querySelector(".panel-body");
  if (!body) return;
  const notice = document.createElement("p");
  notice.className = "empty-note";
  notice.textContent = "This overlay is out of date. Re-drag the bookmarklet from the control room to get the latest version.";
  body.insertBefore(notice, body.firstChild);
}
