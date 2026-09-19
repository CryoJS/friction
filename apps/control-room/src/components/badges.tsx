import { FRICTION_LABELS, SEVERITY_LABELS, type FrictionCategory, type PersonaState, type Severity } from "@friction/shared";

const STATE_STYLES: Record<PersonaState, { label: string; chip: string; dot: string; pulse: boolean }> = {
  idle: { label: "Idle", chip: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400", pulse: false },
  running: { label: "Running", chip: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500", pulse: true },
  succeeded: { label: "Succeeded", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", pulse: false },
  failed: { label: "Failed", chip: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500", pulse: false },
  timeout: { label: "Timed out", chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500", pulse: false },
};

export function StateBadge({ state, prefix }: { state: PersonaState; prefix?: string }) {
  const style = STATE_STYLES[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style.chip}`}>
      <span className="relative flex h-1.5 w-1.5">
        {style.pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${style.dot}`} />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${style.dot}`} />
      </span>
      {prefix ? `${prefix} · ${style.label}` : style.label}
    </span>
  );
}

/** Severity drives colour everywhere: alert borders, report cards, timeline dots. */
export const SEVERITY_STYLES: Record<Severity, { border: string; bg: string; text: string; solid: string; box: string }> = {
  5: { border: "border-l-red-600", bg: "bg-red-50", text: "text-red-700", solid: "bg-red-600 text-white", box: "border-red-500" },
  4: { border: "border-l-orange-500", bg: "bg-orange-50", text: "text-orange-700", solid: "bg-orange-500 text-white", box: "border-orange-500" },
  3: { border: "border-l-amber-400", bg: "bg-amber-50", text: "text-amber-800", solid: "bg-amber-400 text-amber-950", box: "border-amber-400" },
  2: { border: "border-l-sky-400", bg: "bg-sky-50", text: "text-sky-700", solid: "bg-sky-500 text-white", box: "border-sky-400" },
  1: { border: "border-l-slate-300", bg: "bg-slate-50", text: "text-slate-600", solid: "bg-slate-400 text-white", box: "border-slate-400" },
};

export function SeverityBadge({ severity, withLabel = false }: { severity: Severity; withLabel?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${SEVERITY_STYLES[severity].solid}`}
      title={`Severity ${severity} of 5: ${SEVERITY_LABELS[severity]}`}
    >
      S{severity}
      {withLabel && <span className="font-medium opacity-90">{SEVERITY_LABELS[severity]}</span>}
    </span>
  );
}

export function categoryLabel(category: FrictionCategory): string {
  return FRICTION_LABELS[category].label;
}

export function Chip({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "indigo" | "amber" | "emerald" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}
