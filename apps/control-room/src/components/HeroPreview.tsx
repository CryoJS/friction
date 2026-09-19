import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FrictionEvent, StepEvent } from "@friction/shared";
import { getGoldenRun } from "@friction/shared/golden";
import { ACTION_VERBS, formatElapsed, shortUrl } from "../lib/format";
import { Chip, Dot, categoryLabel } from "./badges";

/** Pace of the loop: brisk enough to feel live, slow enough to read a finding. */
const EVENT_MS = 520;
const HOLD_MS = 5200;
const LEAD_MS = 900;

type AgentAccent = "coral" | "amber" | "cobalt";

interface PreviewAgent {
  id: string;
  label: string;
  role: string;
  accent: AgentAccent;
}

const AGENTS: PreviewAgent[] = [
  { id: "scan", label: "agent 01", role: "scan", accent: "cobalt" },
  { id: "trace", label: "agent 02", role: "trace", accent: "coral" },
  { id: "sketch", label: "agent 03", role: "sketch", accent: "amber" },
];

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

/**
 * A copied browser in miniature, replaying the bundled run as several agents
 * inspect one page and leave comments or sketches directly on the UI.
 */
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
  const elapsed = events.length > 1 ? (events[events.length - 1]?.ts ?? 0) - (events[0]?.ts ?? 0) : 0;
  const steps = events.filter((event): event is StepEvent => event.type === "step");
  const findings = events.filter((event): event is FrictionEvent => event.type === "friction");
  const latestStep = steps[steps.length - 1];
  const latestFinding = findings[findings.length - 1];
  const activeAgentIndex = total > 0 ? Math.min(AGENTS.length - 1, Math.floor((count / total) * AGENTS.length)) : 0;
  const activeAgent = AGENTS[activeAgentIndex] ?? AGENTS[0]!;
  const issueAccent = latestFinding ? accentForSeverity(latestFinding.payload.severity) : activeAgent.accent;
  const currentTarget = latestFinding
    ? categoryLabel(latestFinding.payload.category)
    : latestStep
      ? latestStep.payload.targetLabel || latestStep.payload.value || ACTION_VERBS[latestStep.payload.actionType]
      : "interactive surface";

  return (
    <div
      ref={frame}
      role="img"
      aria-label="Preview: multiple agents inspect a copied browser and inject comments and sketches as they find issues."
      className="hero-preview-frame relative w-full rounded-t-large border border-b-0 border-white/25 bg-white/10 p-2 pb-0 backdrop-blur-[4px]"
    >
      <div className="hero-preview-screen flex min-h-0 flex-col overflow-hidden rounded-t-[32px] border border-b-0 border-hairline/10 bg-void">
        <div className="flex shrink-0 items-center gap-2.5 px-4 pb-1.5 pt-3 sm:gap-3 sm:px-5 sm:pt-4">
          <span className="shrink-0">
            <Chip tone="glow">Agent pass - replay</Chip>
          </span>
          <span className="min-w-0 truncate rounded-full border border-hairline/10 px-3 py-0.5 font-mono text-[11px] tracking-normal text-smoke">
            {shortUrl(golden.run.url)}
          </span>
          <span className="ml-auto font-mono text-[12px] tabular-nums tracking-normal text-bone">{formatElapsed(elapsed)}</span>
        </div>
        <p className="shrink-0 truncate px-4 pb-2 text-[13px] text-bone sm:px-5">{golden.run.task || "Agents mark friction in the copied page"}</p>

        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          <div className="hero-preview-copy min-h-0 flex-1">
            <div className="hero-preview-copy-bar">
              <span className="hero-preview-copy-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="truncate">copy / isolated browser</span>
              <span className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.12em] text-smoke">3 agents</span>
            </div>

            <div className="hero-preview-copy-body">
              <div className="hero-preview-copy-heading">
                <span className="hero-preview-copy-heading-line hero-preview-copy-heading-line--wide" />
                <span className="hero-preview-copy-heading-line hero-preview-copy-heading-line--short" />
              </div>
              <span className="hero-preview-copy-line hero-preview-copy-line--wide" />
              <span className="hero-preview-copy-line hero-preview-copy-line--medium" />
              <div className="hero-preview-copy-grid">
                <span className="hero-preview-copy-card" />
                <span className="hero-preview-copy-card hero-preview-copy-card--quiet" />
              </div>

              <span
                className="hero-preview-copy-sketch"
                style={{ "--preview-accent": ACCENTS[issueAccent] } as CSSProperties}
                aria-hidden="true"
              >
                <span className="hero-preview-copy-sketch-handle hero-preview-copy-sketch-handle--top-left" />
                <span className="hero-preview-copy-sketch-handle hero-preview-copy-sketch-handle--top-right" />
                <span className="hero-preview-copy-sketch-handle hero-preview-copy-sketch-handle--bottom-left" />
                <span className="hero-preview-copy-sketch-handle hero-preview-copy-sketch-handle--bottom-right" />
                <span className="hero-preview-copy-sketch-label">
                  <span className="hero-preview-copy-sketch-label-dot" />
                  agent focus
                </span>
              </span>
              <span
                className="hero-preview-copy-sketch-line"
                style={{ "--preview-accent": ACCENTS[issueAccent] } as CSSProperties}
                aria-hidden="true"
              />

              {AGENTS.map((agent, index) => {
                const finding = findings[findings.length - index - 1];
                const accent = finding ? accentForSeverity(finding.payload.severity) : agent.accent;
                const note = finding
                  ? categoryLabel(finding.payload.category)
                  : index === activeAgentIndex
                    ? currentTarget
                    : agent.role === "scan"
                      ? "map controls"
                      : agent.role === "trace"
                        ? "check retry path"
                        : "sketch target";

                return (
                  <span
                    key={agent.id}
                    className={`hero-preview-copy-comment hero-preview-copy-comment--${index + 1}`}
                    style={{ "--preview-accent": ACCENTS[accent] } as CSSProperties}
                  >
                    <span className="hero-preview-copy-comment-agent">{agent.label}</span>
                    <span className="hero-preview-copy-comment-text">{note}</span>
                  </span>
                );
              })}
            </div>
          </div>

          <div className="hero-preview-agent-rail" aria-hidden="true">
            {AGENTS.map((agent, index) => {
              const active = index === activeAgentIndex;
              const noted = index < activeAgentIndex;
              return (
                <div key={agent.id} className={`hero-preview-agent ${active ? "hero-preview-agent--active" : ""}`}>
                  <Dot tone={active ? "glow" : noted ? "good" : "idle"} size={5} />
                  <span className="hero-preview-agent-copy">
                    <span className="hero-preview-agent-name">{agent.label}</span>
                    <span className="hero-preview-agent-role">{active ? "annotating" : noted ? "noted" : "watching"}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function accentForSeverity(severity: number): AgentAccent {
  if (severity >= 4) return "coral";
  if (severity === 3) return "amber";
  return "cobalt";
}
