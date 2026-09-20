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
 * What IS reused -- imported from shell.ts, not copied -- is main.ts's
 * toggle-off sentinel and message-panel shell: clicking this bookmarklet a
 * second time removes the overlay, exactly like the normal one.
 */
import type { AnnotationsResponse } from "@friction/shared";
import { OVERLAY_VERSION } from "@friction/shared";
import { mountOverlay, OVERLAY_ROOT_ID } from "./render";
import { addStalenessNotice, mountMessage, registerSentinel, removeExistingRoot } from "./shell";

declare global {
  interface Window {
    /** Set by the javascript: URL itself, immediately before this bundle's
     * code runs (see BookmarkletCard.tsx): `window.__FRICTION_DATA__=<json>;
     * <this bundle>`. Never read from anywhere else -- there is no fetch and
     * no cache in this entry point. */
    __FRICTION_DATA__?: AnnotationsResponse;
  }
}

function main(): void {
  // Toggle off, exactly like main.ts's requirement 1: either bookmarklet's
  // sentinel (shell.ts's shared shape) is a valid "already mounted" signal
  // for the other.
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
