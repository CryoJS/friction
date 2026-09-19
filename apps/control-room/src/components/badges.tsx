import { FRICTION_LABELS, SEVERITY_LABELS, type AgentState, type FixStage, type FrictionCategory, type Severity } from "@friction/shared";

/** A status light. "glow" is the violet running glow; the rest are flat dots. */
export type Tone = "idle" | "glow" | "good" | "warn" | "bad";

const DOTS: Record<Tone, string> = {
  idle: "bg-slate",
  glow: "glow-dot breathe",
  good: "bg-white",
  warn: "bg-sev-4",
  bad: "bg-sev-5",
};

export function Dot({ tone, size = 8, pulse = false }: { tone: Tone; size?: number; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${DOTS[tone]} ${pulse && tone !== "glow" ? "breathe" : ""}`}
      style={{ width: size, height: size }}
    />
  );
}

const STATE_STYLES: Record<AgentState, { label: string; tone: Tone }> = {
  idle: { label: "Idle", tone: "idle" },
  running: { label: "Running", tone: "glow" },
  succeeded: { label: "Succeeded", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  timeout: { label: "Timed out", tone: "warn" },
};

export function stateTone(state: AgentState): Tone {
  return STATE_STYLES[state].tone;
}

/** `idleLabel` renames the idle state where waiting means something else (a scan's queued runs). */
export function StateBadge({ state, prefix, idleLabel }: { state: AgentState; prefix?: string; idleLabel?: string }) {
  const style = STATE_STYLES[state];
  const label = state === "idle" && idleLabel ? idleLabel : style.label;
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-2 rounded-full border border-hairline/15 px-3 text-caption text-bone">
      <Dot tone={style.tone} />
      {prefix ? (
        <span>
          {prefix} <span className="text-smoke">{label}</span>
        </span>
      ) : (
        label
      )}
    </span>
  );
}

const STAGE_STYLES: Record<FixStage, { label: string; tone: Tone }> = {
  proposed: { label: "Fix proposed", tone: "idle" },
  verifying: { label: "Verifying", tone: "glow" },
  verified: { label: "Verified", tone: "good" },
  rejected: { label: "Did not resolve it", tone: "warn" },
  pr_opened: { label: "Pull request opened", tone: "good" },
};

export function StageBadge({ stage }: { stage: FixStage }) {
  const style = STAGE_STYLES[stage];
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-2 rounded-full border border-hairline/15 px-3 text-caption text-bone">
      <Dot tone={style.tone} />
      {style.label}
    </span>
  );
}

/** Severity runs along the horizon: S5 hot coral down to S1 cool cobalt. */
export const SEVERITY_STYLES: Record<Severity, { text: string; dot: string; box: string; ring: string }> = {
  5: { text: "text-sev-5", dot: "bg-sev-5", box: "border-sev-5", ring: "border-sev-5/45" },
  4: { text: "text-sev-4", dot: "bg-sev-4", box: "border-sev-4", ring: "border-sev-4/45" },
  3: { text: "text-sev-3", dot: "bg-sev-3", box: "border-sev-3", ring: "border-sev-3/45" },
  2: { text: "text-sev-2", dot: "bg-sev-2", box: "border-sev-2", ring: "border-sev-2/45" },
  1: { text: "text-sev-1", dot: "bg-sev-1", box: "border-sev-1", ring: "border-sev-1/45" },
};

export function SeverityBadge({ severity, withLabel = false }: { severity: Severity; withLabel?: boolean }) {
  const style = SEVERITY_STYLES[severity];
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-caption tabular-nums ${style.ring} ${style.text}`}
      title={`Severity ${severity} of 5: ${SEVERITY_LABELS[severity]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />S{severity}
      {withLabel && <span className="text-bone">{SEVERITY_LABELS[severity]}</span>}
    </span>
  );
}

export function categoryLabel(category: FrictionCategory): string {
  return FRICTION_LABELS[category].label;
}

export function Chip({ children, tone = "idle" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span className="tag">
      <Dot tone={tone} size={6} />
      {children}
    </span>
  );
}
