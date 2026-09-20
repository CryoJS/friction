import { useEffect, useRef, useState } from "react";
import { SNAPSHOT_CSP, type AnnotationFinding, type AnnotationsResponse } from "@friction/shared";
import { mountOverlay, type OverlayHandle } from "@friction/overlay/src/render";

/** The viewport the orchestrator captures at (config.VIEWPORT.w). The frame is laid out at this
 *  width and then scaled to fit, so the snapshot reflows exactly as it did during the scan. */
const FRAME_WIDTH = 1280;

/**
 * The snapshot is rendered under SNAPSHOT_CSP (see packages/shared): the
 * Worker sends its own header, but that only covers a frame loaded by URL —
 * this viewer uses srcdoc, so the policy has to travel inside the document
 * instead. `script-src 'none'` plus a sandbox without `allow-scripts` is the
 * actual boundary; the capture-time stripping in the orchestrator is only a
 * first pass.
 *
 * The second injected tag makes the snapshot's own content inert: without
 * scripts, a click on the site's own elements is still a real click, and the
 * sandbox (no `allow-top-navigation`) only stops it from breaking out of the
 * frame -- a link still navigates *this* frame to the real, live URL its
 * `<base href>` resolves against, which then loads under the same
 * script-blocked sandbox and typically renders a blank page. `pointer-events:
 * none` on everything except the overlay's own root stops that click from
 * ever firing, which is also exactly "only the annotations are
 * interactable". `!important` guards against the page's own inline styles;
 * `#__friction-root` doesn't exist in the DOM yet when this is injected, but
 * the selector is evaluated live and the overlay mounts (see onLoad) after
 * this document has already loaded, so it excludes it correctly once it does.
 *
 * Puts both tags first in <head> so they govern everything that follows.
 */
function withPolicy(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${SNAPSHOT_CSP}">`;
  const inert = `<style>body > :not(#__friction-root) { pointer-events: none !important; }</style>`;
  const tags = meta + inert;
  return html.includes("<head")
    ? html.replace(/<head([^>]*)>/i, `<head$1>${tags}`)
    : `${tags}${html}`;
}

/**
 * The scanned page itself, annotated, inside the control room.
 *
 * Loaded through srcdoc rather than by URL, deliberately: the Worker serves
 * snapshots from its own origin (127.0.0.1:8787) while the control room runs on
 * another (localhost:5173), so a src-loaded frame is cross-origin and its
 * contentDocument cannot be reached to mount anything. A srcdoc frame inherits
 * the embedder's origin, which `allow-same-origin` then preserves.
 *
 * `allow-scripts` is deliberately absent, so nothing in a scanned page can
 * execute. The overlay runs in THIS document's JS context and manipulates the
 * frame's DOM, which needs no scripting inside the frame.
 *
 * Findings are handed over with `url: ""`, which the renderer documents as
 * "belongs to the current page". Correct here, and it avoids teaching the
 * overlay about frames: a srcdoc frame's location is `about:srcdoc`, so the
 * normal page-matching would reject every finding.
 */
export function SnapshotViewer({
  snapshotUrl,
  findings,
  scanId,
}: {
  snapshotUrl: string;
  findings: AnnotationFinding[];
  scanId: string;
}): React.ReactElement {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const handleRef = useRef<OverlayHandle | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [located, setLocated] = useState<number | null>(null);
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const [docHeight, setDocHeight] = useState(900);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Fit the captured 1280px-wide page into whatever width this pane has.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = (): void => setScale(fit ? Math.min(1, wrap.clientWidth / FRAME_WIDTH) : 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [fit, html]);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    setLocated(null);
    fetch(snapshotUrl)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`${response.status}`))))
      .then((text) => {
        if (!cancelled) setHtml(withPolicy(text));
      })
      .catch(() => {
        if (!cancelled) setError("This page snapshot could not be loaded.");
      });
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [snapshotUrl]);

  const onLoad = (): void => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !doc.body) return;
    handleRef.current?.destroy();
    const response: AnnotationsResponse = {
      scanId,
      scannedAt: Date.now(),
      url: "",
      overlayVersion: 1,
      findings: findings.map((f) => ({ ...f, url: "" })),
    };
    try {
      handleRef.current = mountOverlay(response, doc);
      // Markers live inside the overlay's shadow root, not the light DOM.
      const root = doc.getElementById("__friction-root");
      setLocated(root?.shadowRoot?.querySelectorAll(".marker").length ?? 0);
      // Let the frame be as tall as the page so the whole thing is visible when scaled,
      // rather than scrolling a short window over a long document.
      setDocHeight(Math.max(600, Math.min(doc.documentElement.scrollHeight, 20000)));
    } catch {
      setError("The overlay could not be drawn on this snapshot.");
    }
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-graphite">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline/10 px-4 py-1.5">
        <span className="truncate text-caption text-smoke">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
          {located !== null ? ` · ${located} placed` : ""}
          {error ? ` · ${error}` : ""}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setFit((v) => !v)} className="pill-ghost" aria-pressed={fit}>
            {fit ? `Fit ${Math.round(scale * 100)}%` : "Actual size"}
          </button>
          <span className="font-mono text-caption tracking-normal text-slate">scripts disabled</span>
        </div>
      </div>

      {html === null && !error ? (
        <div className="flex flex-1 items-center justify-center text-ui text-smoke">Loading the page…</div>
      ) : (
        <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto bg-white">
          {/* The frame is laid out at the capture width and scaled down, so the page
              reflows exactly as it did during the scan and the markers scale with it. */}
          <div style={{ height: docHeight * scale, width: "100%", overflow: "hidden" }}>
            <iframe
              ref={frameRef}
              srcDoc={html ?? ""}
              onLoad={onLoad}
              sandbox="allow-same-origin"
              title="Annotated page snapshot"
              style={{
                width: FRAME_WIDTH,
                height: docHeight,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                border: 0,
                display: "block",
                background: "#fff",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
