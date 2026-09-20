/**
 * A self-contained HTML copy of the page, captured mid-run, so the control
 * room can show the annotated page itself instead of a screenshot.
 *
 * A string, not a function, for the same reason as pageScripts.ts: tsx
 * compiles with esbuild's keepNames, which wraps functions in a __name()
 * helper that does not exist in the remote page.
 *
 * What makes this cheap: ONE <base href> tag. Every relative URL in the
 * captured markup — stylesheets, images, fonts — then resolves against the
 * page's own origin and loads normally when the snapshot is viewed. No
 * inlining, no URL rewriting, no megabyte payloads.
 *
 * What is removed: every <script>, every on* handler, and every javascript:
 * URL. That is a first line of defence only. The snapshot is served from
 * Friction's own origin, so the Worker also sends `script-src 'none'` and the
 * viewer frames it with `sandbox` minus `allow-scripts`. Stripping alone is
 * not a security boundary — SVG, srcdoc and exotic handlers survive naive
 * removal. The sandbox is the boundary.
 *
 * Not captured: form values, scroll position, canvas pixels, shadow DOM, and
 * anything a script would have rendered after this moment. The snapshot shows
 * the DOM as the agent saw it, frozen.
 */

/** Serializes the current document. Returns "" if anything goes wrong; a failed snapshot is never fatal. */
export const CAPTURE_SNAPSHOT = `(() => {
  try {
    const root = document.documentElement.cloneNode(true);

    root.querySelectorAll("script, noscript, template").forEach((n) => n.remove());

    root.querySelectorAll("*").forEach((el) => {
      const attrs = Array.prototype.slice.call(el.attributes);
      for (const a of attrs) {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
        else if (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      }
    });

    let head = root.querySelector("head");
    if (!head) {
      head = document.createElement("head");
      root.insertBefore(head, root.firstChild);
    }
    // Ours must be the only <base>, and first, or relative URLs resolve against the wrong thing.
    root.querySelectorAll("base").forEach((n) => n.remove());
    const base = document.createElement("base");
    base.setAttribute("href", location.href);
    head.insertBefore(base, head.firstChild);

    return "<!DOCTYPE html>" + root.outerHTML;
  } catch (e) {
    return "";
  }
})()`;

/** Largest snapshot worth storing. Past this the page is pathological and a screenshot serves better. */
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
