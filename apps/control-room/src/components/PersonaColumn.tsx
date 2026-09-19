import { isTerminalState, type FrictionEvent, type StepEvent } from "@friction/shared";
import { MAX_STEPS } from "../lib/config";
import { ACTION_VERBS, formatDuration, pathOf } from "../lib/format";
import type { PersonaView } from "../lib/runState";
import { EvidenceImage } from "./EvidenceImage";
import { SEVERITY_STYLES, SeverityBadge, StateBadge, categoryLabel } from "./badges";

interface Props {
  persona: PersonaView;
  /** Only a genuinely live run has a Browserbase session worth embedding. */
  allowLiveView: boolean;
  startTs: number | null;
}

export function PersonaColumn({ persona, allowLiveView, startTs }: Props) {
  const latest = persona.steps[persona.steps.length - 1] ?? null;
  const worst = persona.frictions.reduce<Map<number, FrictionEvent>>((map, friction) => {
    const current = map.get(friction.payload.evidenceSeq);
    if (!current || friction.payload.severity > current.payload.severity) map.set(friction.payload.evidenceSeq, friction);
    return map;
  }, new Map());

  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">{persona.def.displayName}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] tabular-nums text-slate-500" title="Steps taken of the 15-step hard cap">
            {persona.steps.length}/{MAX_STEPS} steps
          </span>
          <StateBadge state={persona.state} />
        </div>
      </header>

      <div className="h-0.5 w-full bg-slate-100">
        <div
          className={`h-full transition-all duration-500 ${persona.steps.length > 12 ? "bg-amber-400" : "bg-indigo-500"}`}
          style={{ width: `${Math.min(100, (persona.steps.length / MAX_STEPS) * 100)}%` }}
        />
      </div>

      <LiveView persona={persona} latest={latest} allowLiveView={allowLiveView} />
      <CurrentAction persona={persona} latest={latest} />

      <div className="flex min-h-0 flex-1 flex-col">
        <PaneTitle title="Timeline" count={persona.steps.length} />
        <ol className="pane min-h-[72px] flex-1 overflow-y-auto px-1.5 pb-1.5">
          {persona.steps.length === 0 && <li className="px-1.5 py-2 text-xs text-slate-400">No steps yet.</li>}
          {[...persona.steps].reverse().map((step, index) => (
            <TimelineRow
              key={step.seq}
              step={step}
              number={persona.steps.length - index}
              friction={worst.get(step.seq) ?? null}
              startTs={startTs}
            />
          ))}
        </ol>

        <PaneTitle title="Friction" count={persona.frictions.length} tone={persona.frictions.length > 0 ? "alert" : "quiet"} />
        <div className="pane max-h-[38%] min-h-[56px] shrink-0 space-y-1.5 overflow-y-auto px-2 pb-2">
          {persona.frictions.length === 0 && <p className="py-1 text-xs text-slate-400">Nothing detected.</p>}
          {[...persona.frictions]
            .sort((a, b) => b.payload.severity - a.payload.severity || b.seq - a.seq)
            .map((friction) => (
              <FrictionAlert key={friction.seq} friction={friction} stepNumber={stepNumberOf(persona.steps, friction.payload.evidenceSeq)} />
            ))}
        </div>
      </div>
    </section>
  );
}

function stepNumberOf(steps: readonly StepEvent[], seq: number): number | null {
  const index = steps.findIndex((step) => step.seq === seq);
  return index < 0 ? null : index + 1;
}

function PaneTitle({ title, count, tone = "quiet" }: { title: string; count: number; tone?: "quiet" | "alert" }) {
  return (
    <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 pb-1 pt-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      <span
        className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
          tone === "alert" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"
        }`}
      >
        {count}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- live view */

function withoutNavbar(url: string): string {
  if (/[?&]navbar=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}navbar=false`;
}

function LiveView({ persona, latest, allowLiveView }: { persona: PersonaView; latest: StepEvent | null; allowLiveView: boolean }) {
  const sessionLive = allowLiveView && persona.liveViewUrl !== null && !isTerminalState(persona.state);

  if (sessionLive && persona.liveViewUrl) {
    return (
      <div className="relative aspect-video w-full shrink-0 bg-slate-900">
        <iframe
          key={persona.liveViewUrl}
          src={withoutNavbar(persona.liveViewUrl)}
          title={`${persona.def.displayName}: Browserbase live view`}
          sandbox="allow-same-origin allow-scripts"
          allow="clipboard-read; clipboard-write"
          className="absolute inset-0 h-full w-full border-0"
          style={{ pointerEvents: "none" }}
        />
        <Corner tone="live">Live</Corner>
      </div>
    );
  }

  if (latest) {
    return (
      <div className="relative shrink-0">
        <EvidenceImage
          source={{ screenshotKey: latest.payload.screenshotKey, bbox: latest.payload.bbox, viewport: latest.payload.viewport, payload: latest.payload }}
          label={latest.payload.targetLabel}
        />
        <Corner tone="still">{isTerminalState(persona.state) ? "Final screenshot" : "Latest screenshot"}</Corner>
      </div>
    );
  }

  // Placeholder until the live view URL arrives over the stream.
  return (
    <div className="flex aspect-video w-full shrink-0 flex-col items-center justify-center gap-2 bg-slate-50 px-6 text-center">
      <p className="max-w-xs text-xs leading-relaxed text-slate-600">{persona.def.description}</p>
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        {isTerminalState(persona.state) ? (
          (persona.statusMessage ?? "No browser session was recorded.")
        ) : (
          <>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
            {persona.statusMessage ?? "Waiting for a Browserbase session"}
          </>
        )}
      </p>
    </div>
  );
}

function Corner({ children, tone }: { children: React.ReactNode; tone: "live" | "still" }) {
  return (
    <span
      className={`absolute left-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        tone === "live" ? "top-2 bg-red-600 text-white" : "bottom-2 bg-slate-900/75 text-white"
      }`}
    >
      {tone === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
      {children}
    </span>
  );
}

/* ----------------------------------------------------------- current action */

function targetText(step: StepEvent): string {
  const p = step.payload;
  switch (p.actionType) {
    case "navigate":
      return pathOf(p.value ?? p.url);
    case "scroll":
      return p.value ?? "down";
    case "wait":
      return "for the page";
    case "press":
      return p.targetLabel ? `${compactKeys(p.value ?? "")} → “${p.targetLabel}”` : compactKeys(p.value ?? "");
    case "type":
      return `“${p.value ?? ""}” into ${p.targetLabel || "the focused field"}`;
    case "select":
      return `${p.targetLabel}: ${p.value ?? ""}`;
    default:
      return p.targetLabel ? `“${p.targetLabel}”` : "(unlabelled element)";
  }
}

/** "Tab Tab Tab Enter" -> "Tab ×3, Enter" */
function compactKeys(keys: string): string {
  const out: string[] = [];
  let previous = "";
  let run = 0;
  for (const key of [...keys.split(/\s+/).filter(Boolean), ""]) {
    if (key === previous) {
      run += 1;
      continue;
    }
    if (previous) out.push(run > 1 ? `${previous} ×${run}` : previous);
    previous = key;
    run = 1;
  }
  return out.join(", ");
}

function CurrentAction({ persona, latest }: { persona: PersonaView; latest: StepEvent | null }) {
  const finished = isTerminalState(persona.state);
  return (
    <div className="shrink-0 border-t border-slate-100 px-3 py-2.5">
      {latest ? (
        <div key={latest.seq} className="step-in">
          <p className="flex items-baseline gap-1.5 text-sm font-semibold leading-snug text-slate-900">
            <span className="shrink-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              {ACTION_VERBS[latest.payload.actionType]}
            </span>
            <span className="min-w-0 break-words">{targetText(latest)}</span>
          </p>
          <p className="mt-1 text-[13px] leading-snug text-slate-600">“{latest.payload.rationale}”</p>
        </div>
      ) : (
        <p className="text-sm text-slate-400">{finished ? "No actions were taken." : "Waiting for the first action"}</p>
      )}

      {finished ? (
        <p
          className={`mt-2 rounded px-2 py-1 text-xs leading-snug ${
            persona.state === "succeeded" ? "bg-emerald-50 text-emerald-800" : persona.state === "timeout" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"
          }`}
        >
          {persona.done?.payload.summary ?? persona.statusMessage ?? (persona.state === "succeeded" ? "Task complete." : "Did not complete the task.")}
        </p>
      ) : (
        persona.state === "running" && <div className="thinking mt-2 h-1 w-full rounded-full" title="Observing the page and planning the next action" />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- timeline */

function TimelineRow({ step, number, friction, startTs }: { step: StepEvent; number: number; friction: FrictionEvent | null; startTs: number | null }) {
  const p = step.payload;
  const slow = p.durationMs > 5000;
  return (
    <li
      className="step-in group flex items-baseline gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50"
      title={`${p.rationale}\n${p.url}${p.selector ? `\n${p.selector}` : ""}`}
    >
      <span className="w-5 shrink-0 text-right tabular-nums text-slate-400">{number}</span>
      <span className="w-11 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{ACTION_VERBS[p.actionType]}</span>
      <span className="min-w-0 flex-1 truncate text-slate-800">{targetText(step)}</span>
      {friction && (
        <span className="shrink-0" title={friction.payload.summary ?? categoryLabel(friction.payload.category)}>
          <SeverityBadge severity={friction.payload.severity} />
        </span>
      )}
      <span className={`shrink-0 tabular-nums ${slow ? "font-semibold text-red-600" : "text-slate-400"}`}>{formatDuration(p.durationMs)}</span>
      {startTs !== null && <span className="hidden w-9 shrink-0 text-right tabular-nums text-slate-300 xl:inline">+{Math.max(0, Math.round((step.ts - startTs) / 1000))}s</span>}
    </li>
  );
}

/* ------------------------------------------------------------------ friction */

function FrictionAlert({ friction, stepNumber }: { friction: FrictionEvent; stepNumber: number | null }) {
  const p = friction.payload;
  const style = SEVERITY_STYLES[p.severity];
  return (
    <article className={`step-in rounded border border-l-4 border-slate-200 ${style.border} ${style.bg} px-2 py-1.5`}>
      <div className="flex items-center gap-1.5">
        <SeverityBadge severity={p.severity} />
        <h4 className={`text-xs font-semibold ${style.text}`}>{categoryLabel(p.category)}</h4>
        <span className="ml-auto text-[10px] tabular-nums text-slate-500">
          {stepNumber !== null && `step ${stepNumber} · `}
          {Math.round(p.confidence * 100)}%
        </span>
      </div>
      {p.summary && <p className="mt-1 text-xs leading-snug text-slate-800">{p.summary}</p>}
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-600" title={p.recommendation}>
        <span className="font-semibold text-slate-700">Fix: </span>
        {p.recommendation}
      </p>
    </article>
  );
}
