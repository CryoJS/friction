/**
 * The offline bookmarklet's entry point (Task 12).
 *
 * This exists ONLY for the CSP failure path main.ts's network-failure panel
 * points at: a site with a strict `connect-src` blocks main.ts's fetch to
 * WORKER_ORIGIN outright, no matter what it is. This variant needs no
 * network at all -- the scan's AnnotationsResponse is baked directly into
 * the `javascript:` URL by BookmarkletCard.tsx (per scan, at render time),
 * assigned to `window.__FRICTION_DATA__` before this bundle's own code runs.
 * See build.mjs for why this file is built separately and left un-encoded.
 *
 * Deliberately narrower than main.ts: no fetch, no sessionStorage read or
 * write (the payload is already in hand, so there is nothing to cache and
 * nothing to have cached), and none of main.ts's CSP/404/malformed-response
 * panels (none of those failures can happen here -- there is no request).
 * What IS reused is main.ts's toggle-off sentinel: clicking this bookmarklet
 * a second time removes the overlay, exactly like the normal one.
 */
import type { AnnotationsResponse } from "@friction/shared";
import { OVERLAY_VERSION } from "@friction/shared";
import { mountOverlay, OVERLAY_ROOT_ID, type OverlayHandle } from "./render";
import { CSS } from "./styles";

/** Mirrors main.ts's OverlaySentinel exactly -- both bundles' sentinels must
 * agree on shape, since either one might be the "existing" one a later click
 * (of either bookmarklet) finds and toggles off. */
interface OverlaySentinel {
  version: number;
  destroy(): void;
}

declare global {
  interface Window {
    __frictionOverlay?: OverlaySentinel;
    /** Set by the javascript: URL itself, immediately before this bundle's
     * code runs (see BookmarkletCard.tsx): `window.__FRICTION_DATA__=<json>;
     * <this bundle>`. Never read from anywhere else -- there is no fetch and
     * no cache in this entry point. */
    __FRICTION_DATA__?: AnnotationsResponse;
  }
}

function registerSentinel(destroy: () => void): void {
  window.__frictionOverlay = { version: OVERLAY_VERSION, destroy };
}

/** See main.ts's removeExistingRoot: mountOverlay appends its root before it
 * finishes resolving every finding, so a throw partway through can leave a
 * first, orphaned root behind. Called before every fresh `#__friction-root`
 * append so mounting stays idempotent regardless of why a previous attempt
 * didn't finish cleanly. */
function removeExistingRoot(): void {
  document.getElementById(OVERLAY_ROOT_ID)?.remove();
}

/** A trimmed copy of main.ts's mountMessage: same shell (shadow root +
 * styles.ts's CSS) so a failure here still looks like the same product, but
 * without the optional link -- this bundle never has anywhere useful to
 * link to (it doesn't know the control room's origin, and was never told a
 * scan id to build a URL from beyond the data it already tried to read). */
function mountMessage(message: string): OverlayHandle {
  removeExistingRoot();
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
  panel.appendChild(body);

  shadow.appendChild(panel);
  document.body.appendChild(root);

  return {
    destroy(): void {
      root.remove();
    },
    focusFinding(): void {},
  };
}

/** Same wording as main.ts's addStalenessNotice -- both bundles are built
 * from the same OVERLAY_VERSION at the same time, but an offline bookmarklet
 * dragged long ago can easily outlive a redeploy, same as the online one. */
function addStalenessNotice(): void {
  const shadow = document.getElementById(OVERLAY_ROOT_ID)?.shadowRoot;
  const body = shadow?.querySelector(".panel-body");
  if (!body) return;
  const notice = document.createElement("p");
  notice.className = "empty-note";
  notice.textContent = "This overlay is out of date. Re-drag the bookmarklet from the control room to get the latest version.";
  body.insertBefore(notice, body.firstChild);
}

function main(): void {
  // Toggle off, exactly like main.ts's requirement 1: either bookmarklet's
  // sentinel is a valid "already mounted" signal for the other.
  const existing = window.__frictionOverlay;
  if (existing) {
    existing.destroy();
    delete window.__frictionOverlay;
    return;
  }

  const data = window.__FRICTION_DATA__;
  if (!data) {
    // Not a modeled failure the brief lists -- this bundle is only ever run
    // via the exact assignment BookmarkletCard.tsx builds, so this branch is
    // a defensive backstop (a hand-edited bookmark, a copy-paste mistake),
    // not a path real usage should hit.
    registerSentinel(mountMessage("Friction: no scan data found in this bookmarklet. Drag a fresh copy from the control room.").destroy);
    return;
  }

  try {
    removeExistingRoot();
    const handle = mountOverlay(data, document);
    registerSentinel(handle.destroy);
    if (data.overlayVersion > OVERLAY_VERSION) {
      addStalenessNotice();
    }
  } catch (err) {
    // Mirrors main.ts's mountResponseSafely: a malformed payload must still
    // leave the user with a message, not nothing.
    registerSentinel(mountMessage(`Friction couldn't display this scan: ${err instanceof Error ? err.message : String(err)}`).destroy);
  }
}

// Belt and braces, mirroring main.ts's own top-level catch: nothing above is
// expected to throw outside the guarded mountOverlay call, but this is a
// `javascript:` URL running on someone else's site, so an unmodeled failure
// still must not leave the user looking at nothing.
try {
  main();
} catch (err) {
  if (!document.getElementById(OVERLAY_ROOT_ID)) {
    registerSentinel(
      mountMessage(`Friction hit an unexpected error: ${err instanceof Error ? err.message : String(err)}`).destroy,
    );
  }
}
