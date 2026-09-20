import { useEffect, useMemo, useRef, useState } from "react";
import bookmarklet from "@friction/overlay/dist/bookmarklet.txt?raw";
import offlineBundle from "@friction/overlay/dist/overlay-offline.iife.js?raw";
import type { AnnotationsResponse } from "@friction/shared";
import { api, ApiError } from "../lib/api";
import { Check } from "./icons";

/** Firefox handles roughly 64 KB in a javascript: URL; this leaves headroom
 * rather than cutting it exactly at the edge (Task 12, step 3). */
const OFFLINE_HREF_LIMIT = 60_000;

/**
 * A bookmarklet cannot be installed by script -- it has to be dragged. So
 * this is a real anchor whose href IS the bookmarklet, with drag
 * instructions, and a copy fallback for browsers where dragging is awkward.
 *
 * The href is set imperatively via a ref, not as a JSX prop: React 19
 * sanitizes any `href`/`src`/`action` value it detects as a `javascript:`
 * URL, rewriting the DOM attribute to a stub that just throws (see
 * `sanitizeURL` in react-dom). That rewrite happens the moment React commits
 * the prop, so a JSX `href={bookmarklet}` never actually reaches the DOM --
 * dragging the link would save a broken bookmark. Setting the attribute
 * outside React's render cycle bypasses that sanitizer entirely.
 *
 * `onClick` calls `preventDefault()`: clicking the link inside the control
 * room would run the overlay against the control room itself, which has no
 * scan, producing a confusing 404 panel.
 *
 * The offline link (Task 12) is the escape hatch for a site whose
 * `connect-src` CSP blocks the primary bookmarklet's fetch: its href carries
 * this scan's own findings inline, so it needs no network at all. It is a
 * SECOND `javascript:` URL, assembled fresh per scan (main.ts's bookmarklet
 * never changes; this one is built from a fetch that resolves after first
 * render), so it hits the exact same React 19 sanitizer -- set imperatively
 * via its own ref, never as a JSX prop, same as the primary link. Unlike the
 * primary link, this one's *value* changes at runtime (a different scan
 * selected, or the fetch settling), so the effect that sets it depends on
 * `offlineHref` -- and `offlineHref` is null (rendering nothing draggable)
 * until that scan's own annotations have actually arrived, so there is no
 * window where this link is draggable while still carrying a previous
 * scan's -- or no -- data.
 */
export function BookmarkletCard({ scanId, scanUrl }: { scanId: string; scanUrl: string }) {
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const offlineLinkRef = useRef<HTMLAnchorElement>(null);
  const [annotations, setAnnotations] = useState<AnnotationsResponse | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const host = (() => {
    try {
      return new URL(scanUrl).hostname;
    } catch {
      return scanUrl;
    }
  })();

  useEffect(() => {
    linkRef.current?.setAttribute("href", bookmarklet);
  }, []);

  // Fetches THIS scan's own findings so the offline link can inline them.
  // Re-runs whenever scanId changes -- a different completed scan selected
  // in the control room -- and clears the previous scan's annotations first,
  // so the effect below never has a stale response to build a href from.
  useEffect(() => {
    let cancelled = false;
    setAnnotations(null);
    setOfflineError(null);
    api
      .getAnnotations(scanId)
      .then((response) => {
        if (!cancelled) setAnnotations(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) setOfflineError(err instanceof ApiError ? err.message : "couldn't load this scan's findings");
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  // Requirement (Task 12, step 2): the offline bundle carries this exact
  // scan's data, never a stale or empty one -- null until `annotations`
  // itself has settled for THIS scanId.
  const offlineHref = useMemo(() => {
    if (!annotations) return null;
    return `javascript:${encodeURIComponent(`window.__FRICTION_DATA__=${JSON.stringify(annotations)};${offlineBundle}`)}`;
  }, [annotations]);

  const offlineTooLarge = offlineHref !== null && offlineHref.length > OFFLINE_HREF_LIMIT;
  const offlineReady = offlineHref !== null && !offlineTooLarge;

  useEffect(() => {
    if (offlineReady && offlineHref) {
      offlineLinkRef.current?.setAttribute("href", offlineHref);
    } else {
      offlineLinkRef.current?.removeAttribute("href");
    }
  }, [offlineHref, offlineReady]);

  const copy = () => {
    void navigator.clipboard.writeText(bookmarklet).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section aria-label="Bookmarklet" className="rounded-card border border-hairline/10 bg-white/4 p-5">
      <h3 className="font-heading text-subheading text-bone">See these findings on your own site</h3>
      <p className="mt-1.5 text-ui text-ash">
        Drag the button below to your bookmarks bar. Then open <span className="font-mono tracking-normal text-bone">{host}</span> and click it — the findings
        appear on the real elements of the page.
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <a ref={linkRef} draggable onClick={(event) => event.preventDefault()} className="pill-cta cursor-grab active:cursor-grabbing">
          Annotate my site
        </a>
        <button type="button" onClick={copy} className="pill-ghost">
          {copied ? (
            <>
              <Check size={14} />
              Copied
            </>
          ) : (
            "Copy the bookmarklet instead"
          )}
        </button>
        {offlineReady ? (
          <a ref={offlineLinkRef} draggable onClick={(event) => event.preventDefault()} className="pill-ghost cursor-grab active:cursor-grabbing">
            Site blocking it? Offline version
          </a>
        ) : (
          <button type="button" disabled className="pill-ghost">
            Site blocking it? Offline version
          </button>
        )}
      </div>
      {offlineTooLarge && (
        <p className="mt-2 text-caption text-smoke">
          This scan has too many findings for the offline bookmarklet to carry (it would exceed what Firefox allows in a saved link). Use "Annotate my
          site" instead, or ask the site owner to allow requests to the Friction worker in their Content-Security-Policy.
        </p>
      )}
      {offlineError && (
        <p className="mt-2 text-caption text-smoke">Couldn't prepare the offline version: {offlineError}</p>
      )}
    </section>
  );
}
