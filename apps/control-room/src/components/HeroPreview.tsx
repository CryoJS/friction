import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FrictionEvent } from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { MousePointer2 } from "lucide-react";

/** Pace of the loop: quick enough to feel alive, calm enough to read. */
const EVENT_MS = 620;
const HOLD_MS = 2800;
const LEAD_MS = 700;

type AgentAccent = "coral" | "amber" | "cobalt";

const TARGET_LABELS = ["headline", "content card", "interaction"] as const;

const ISSUE_FEED = [
  { label: "Dead click", accent: "var(--color-sev-5)" },
  { label: "Long wait", accent: "var(--color-sev-4)" },
  { label: "Ambiguous label", accent: "var(--color-sev-2)" },
] as const;

const ACCENTS: Record<AgentAccent, string> = {
  coral: "var(--color-sev-5)",
  amber: "var(--color-sev-4)",
  cobalt: "var(--color-sev-1)",
};

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

/** A compact cartoon of an agent moving a focus box over a simple page. */
export function HeroPreview() {
  const golden = useMemo(() => getGoldenRun(), []);
  const total = golden.events.length;
  const frame = useRef<HTMLDivElement>(null);
  const visible = useInView(frame);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const delay = count >= total ? HOLD_MS : count === 0 ? LEAD_MS : EVENT_MS;
    const timer = window.setTimeout(() => setCount((current) => (current >= total ? 0 : current + 1)), delay);
    return () => window.clearTimeout(timer);
  }, [count, total, visible]);

  const events = useMemo(() => golden.events.slice(0, count), [golden, count]);
  const findings = events.filter((event): event is FrictionEvent => event.type === "friction");
  const latestFinding = findings[findings.length - 1];
  const activeTarget = Math.min(TARGET_LABELS.length - 1, Math.floor((count / Math.max(total, 1)) * TARGET_LABELS.length));
  const accent = latestFinding ? accentForSeverity(latestFinding.payload.severity) : "cobalt";
  const accentStyle = { "--preview-accent": ACCENTS[accent] } as CSSProperties;

  return (
    <div ref={frame} role="img" aria-label="Preview: an agent moves over a copied website and marks friction points." className="hero-preview-frame">
      <div className="hero-preview-screen">
        <div className="hero-preview-topbar">
          <span className="hero-preview-window-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="hero-preview-url">scan.friction/preview</span>
          <span className="hero-preview-live">
            <span />
            observing
          </span>
        </div>

        <div className="hero-preview-stage">
          <div className="hero-preview-page">
            <div className="hero-preview-page-header">
              <span className="hero-preview-page-logo" />
              <span className="hero-preview-page-menu"><i /><i /><i /></span>
            </div>
            <div className="hero-preview-page-title-group">
              <div className="hero-preview-page-title"><span /><span /></div>
              <span className="hero-preview-page-copy hero-preview-page-copy--wide" />
              <span className="hero-preview-page-copy hero-preview-page-copy--short" />
              {activeTarget === 0 && <FocusBox label="headline" style={accentStyle} />}
            </div>
            <div className="hero-preview-page-cards">
              <span className="hero-preview-page-card">
                <i /><b /><em />
                {activeTarget === 1 && <FocusBox label="content card" style={accentStyle} />}
              </span>
              <span className="hero-preview-page-card hero-preview-page-card--warm">
                <i /><b /><em />
                {activeTarget === 2 && <FocusBox label="interaction" style={accentStyle} />}
              </span>
            </div>
          </div>

          <div className="hero-preview-issue-feed" aria-hidden="true">
            <div className="hero-preview-issue-feed-header">
              <span>Issues</span>
              <span>03</span>
            </div>
            {ISSUE_FEED.map((issue, index) => (
              <div
                key={issue.label}
                className={`hero-preview-issue-feed-row ${index === 0 ? "hero-preview-issue-feed-row--active" : ""}`}
                style={{ "--issue-accent": issue.accent, "--issue-delay": `${index * 0.55}s` } as CSSProperties}
              >
                <i />
                <span>{issue.label}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

function FocusBox({ label, style }: { label: string; style: CSSProperties }) {
  return (
    <span className="hero-preview-focus" style={style} aria-hidden="true">
      <span className="hero-preview-focus-corner hero-preview-focus-corner--tl" />
      <span className="hero-preview-focus-corner hero-preview-focus-corner--tr" />
      <span className="hero-preview-focus-corner hero-preview-focus-corner--bl" />
      <span className="hero-preview-focus-corner hero-preview-focus-corner--br" />
      <span className="hero-preview-focus-label">{label}</span>
      <MousePointer2 className="hero-preview-cursor" fill="currentColor" stroke="currentColor" strokeWidth={1.5} />
    </span>
  );
}

function accentForSeverity(severity: number): AgentAccent {
  if (severity >= 4) return "coral";
  if (severity === 3) return "amber";
  return "cobalt";
}
