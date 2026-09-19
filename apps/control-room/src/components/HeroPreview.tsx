import { useEffect, useMemo, useRef, useState } from "react";
import { isTerminalState } from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { ACTION_VERBS, formatElapsed, shortUrl } from "../lib/format";
import { viewFromSnapshot, type LaneView } from "../lib/runState";
import { Chip, Dot, SEVERITY_STYLES, categoryLabel, stateTone } from "./badges";
import { EvidenceImage } from "./EvidenceImage";

/** Pace of the loop: brisk enough to feel live, slow enough to read a verb. */
const EVENT_MS = 520;
const HOLD_MS = 5200;
const LEAD_MS = 900;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useInView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

/**
 * The control room in miniature, replaying the golden run that ships inside
 * this bundle. No network: it is the same fixture and the same reducer the
 * real control room uses, just scaled down and looped.
 */
export function HeroPreview() {
  const golden = useMemo(() => getGoldenRun(), []);
  const total = golden.events.length;
  const reduced = usePrefersReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const visible = useInView(frame);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (reduced || !visible) return;
    const delay = count >= total ? HOLD_MS : count === 0 ? LEAD_MS : EVENT_MS;
    const timer = window.setTimeout(() => setCount((current) => (current >= total ? 0 : current + 1)), delay);
    return () => window.clearTimeout(timer);
  }, [count, total, visible, reduced]);

  const shown = reduced ? total : count;
  const view = useMemo(() => viewFromSnapshot(golden, shown), [golden, shown]);
  const elapsed = view.firstTs !== null && view.lastTs !== null ? view.lastTs - view.firstTs : 0;

  return (
    <div
      ref={frame}
      role="img"
      aria-label="Preview: the control room replaying the bundled golden run, one agent attempting the task with friction appearing as it is detected."
      className="hero-preview-frame relative w-full rounded-t-large border border-b-0 border-white/25 bg-white/10 p-2 pb-0 backdrop-blur-[4px]"
    >
      <div className="hero-preview-screen overflow-hidden rounded-t-[32px] border border-b-0 border-hairline/10 bg-void">
        <div className="flex items-center gap-3 px-5 pb-2.5 pt-4">
          <span className="shrink-0">
            <Chip tone="good">Golden run · replay</Chip>
          </span>
          <span className="min-w-0 truncate rounded-full border border-hairline/10 px-3 py-0.5 font-mono text-[11px] tracking-normal text-smoke">
            {view.run ? shortUrl(view.run.url) : "golden"}
          </span>
          <span className="ml-auto font-mono text-[12px] tabular-nums tracking-normal text-bone">{formatElapsed(elapsed)}</span>
        </div>
        <p className="truncate px-5 pb-3 text-[14px] text-bone">{view.run?.task ?? "The golden run"}</p>
        <div className="px-3 pb-3">
          <Lane lane={view.primary} />
        </div>
      </div>
    </div>
  );
}

function Lane({ lane }: { lane: LaneView }) {
  const latest = lane.steps[lane.steps.length - 1] ?? null;
  const frictions = [...lane.frictions].reverse().slice(0, 3);
  const finished = isTerminalState(lane.state);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] overflow-hidden rounded-[16px] border border-hairline/10 bg-white/4">
      {latest ? (
        <EvidenceImage
          source={{ screenshotKey: latest.payload.screenshotKey, bbox: latest.payload.bbox, viewport: latest.payload.viewport, payload: latest.payload }}
          boxClass="border-white"
        />
      ) : (
        <div className="aspect-video w-full bg-graphite" />
      )}
      <div className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-bone">Step {lane.steps.length}</span>
          <Dot tone={stateTone(lane.state)} size={6} />
        </div>
        {latest ? (
          <p key={latest.seq} className="step-in line-clamp-2 text-[11px] text-ash">
            <span className="text-bone">{ACTION_VERBS[latest.payload.actionType]}</span> {latest.payload.targetLabel || latest.payload.value || ""}
          </p>
        ) : (
          <p className="text-[11px] text-smoke">Opening a browser</p>
        )}
        {!finished && lane.state === "running" && <div className="wash wash-sweep h-px w-full" />}
        {frictions.map((friction) => (
          <p key={friction.payload.findingId ?? friction.seq} className="step-in flex min-w-0 items-center gap-1.5 text-[11px]">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_STYLES[friction.payload.severity].dot}`} />
            <span className={`min-w-0 truncate ${SEVERITY_STYLES[friction.payload.severity].text}`}>
              {categoryLabel(friction.payload.category)}
              {(friction.payload.hitCount ?? 1) > 1 && ` ×${friction.payload.hitCount}`}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}
