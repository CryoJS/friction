import { useEffect, useRef, useState } from "react";
import bookmarklet from "@friction/overlay/dist/bookmarklet.txt?raw";
import { Check } from "./icons";

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
 */
export function BookmarkletCard({ scanUrl }: { scanUrl: string }) {
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
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
      </div>
    </section>
  );
}
