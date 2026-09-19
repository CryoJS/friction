import { isTerminalState, type FrictionEvent, type StepEvent } from "@friction/shared";
import { MAX_STEPS } from "../lib/config";
import { ACTION_VERBS, formatDuration, pathOf } from "../lib/format";
import { AGENT_BLURB, type LaneView } from "../lib/runState";
import { EvidenceImage } from "./EvidenceImage";
import { Dot, SEVERITY_STYLES, SeverityBadge, StateBadge, categoryLabel, stateTone } from "./badges";

interface Props {
  lane: LaneView;
  title: string;
  /** One line under the title, e.g. "lane primary · 14 steps · gave up". */
  subtitle?: string;
  /** Border colour: a verified "after" reads good, a rejected one warns. */
  accent?: "none" | "good" | "warn";
  /** Only a genuinely live run has a Browserbase session worth embedding. */
  allowLiveView: boolean;
  startTs: number | null;
  /**
   * wide     one pane fills the room: view and action on the left, findings and timeline on the right
   * stacked  view, action, findings, timeline top to bottom; for panes that sit side by side
   */
  layout?: "wide" | "stacked";
}

const ACCENTS: Record<NonNullable<Props["accent"]>, string> = {
  none: "border-hairline/10",
  good: "border-white/35",
  warn: "border-sev-3/55",
};

/**
 * One agent run: live view (or its latest screenshot), the current action, and
 * its findings and timeline. The primary and verify lanes carry the same event
 * schema, so this one component renders either.
 */
export function LanePane({ lane, title, subtitle, accent = "none", allowLiveView, startTs, layout = "wide" }: Props) {
  const latest = lane.steps[lane.steps.length - 1] ?? null;
  const worst = lane.frictions.reduce<Map<number, FrictionEvent>>((map, friction) => {
    for (const seq of new Set([friction.payload.evidenceSeq, friction.payload.lastSeq ?? friction.payload.evidenceSeq])) {
      const current = map.get(seq);
      if (!current || friction.payload.severity > current.payload.severity) map.set(seq, friction);
    }
    return map;
  }, new Map());

  const view = (
    <>
      <div className="shrink-0 px-3 pt-3">
        {/* On a short laptop screen the still shrinks (keeping its aspect) so the findings stay in view. */}
        <div className={`mx-auto w-full ${layout === "stacked" ? "" : "lg:[@media(max-height:860px)]:w-[min(100%,calc(42vh*16/9))]"}`}>
          <LiveView lane={lane} title={title} latest={latest} allowLiveView={allowLiveView} />
        </div>
      </div>
      <CurrentAction lane={lane} latest={latest} />
    </>
  );

  const details = (
    <div className={`pane min-h-[96px] flex-1 overflow-y-auto pb-2 ${layout === "stacked" ? "max-h-[340px]" : ""}`}>
      <PaneTitle title="Friction" count={lane.frictions.length} tone={lane.frictions.length > 0 ? "alert" : "quiet"} />
      <div className="space-y-2 px-3 pb-3">
        {lane.frictions.length === 0 && <p className="px-2 py-1 text-caption text-smoke">Nothing detected.</p>}
        {[...lane.frictions]
          .sort((a, b) => b.payload.severity - a.payload.severity || a.seq - b.seq)
          .map((friction) => (
            <FrictionAlert key={friction.payload.findingId ?? friction.seq} friction={friction} stepNumber={stepNumberOf(lane.steps, friction.payload.evidenceSeq)} />
          ))}
      </div>

      <PaneTitle title="Timeline" count={lane.steps.length} />
      <ol className="px-3">
        {lane.steps.length === 0 && <li className="px-2 py-1.5 text-caption text-smoke">No steps yet.</li>}
        {[...lane.steps].reverse().map((step, index) => (
          <TimelineRow key={step.seq} step={step} number={lane.steps.length - index} friction={worst.get(step.seq) ?? null} startTs={startTs} />
        ))}
      </ol>
    </div>
  );

  return (
    <section className={`flex min-h-0 min-w-0 flex-col rounded-card border bg-white/4 lg:overflow-hidden ${ACCENTS[accent]}`} aria-label={title}>
      <header className="flex items-center justify-between gap-3 px-5 pb-2.5 pt-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-body text-white">{title}</h2>
          {subtitle && <p className="truncate text-caption tabular-nums text-smoke">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-caption tabular-nums text-smoke" title={`Steps taken of the ${MAX_STEPS}-step hard cap`}>
            {lane.steps.length}/{MAX_STEPS}
          </span>
          <StateBadge state={lane.state} />
        </div>
      </header>

      <div
        className="mx-5 h-0.5 shrink-0 overflow-hidden rounded-full bg-hairline/10"
        role="progressbar"
        aria-label={`Steps taken of the ${MAX_STEPS}-step hard cap`}
        aria-valuemin={0}
        aria-valuemax={MAX_STEPS}
        aria-valuenow={lane.steps.length}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out-expo ${lane.steps.length > 12 ? "bg-sev-4" : "bg-bone"}`}
          style={{ width: `${Math.min(100, (lane.steps.length / MAX_STEPS) * 100)}%` }}
        />
      </div>

      {layout === "wide" ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col">{view}</div>
          <div className="flex min-h-0 min-w-0 flex-col lg:border-l lg:border-hairline/10">{details}</div>
        </div>
      ) : (
        <>
          {view}
          {details}
        </>
      )}
    </section>
  );
}

function stepNumberOf(steps: readonly StepEvent[], seq: number): number | null {
  const index = steps.findIndex((step) => step.seq === seq);
  return index < 0 ? null : index + 1;
}

function PaneTitle({ title, count, tone = "quiet" }: { title: string; count: number; tone?: "quiet" | "alert" }) {
  return (
    <div className="mx-5 flex shrink-0 items-center gap-2 border-t border-hairline/10 pb-2 pt-3">
      <h3 className="text-caption text-ash">{title}</h3>
      <span className={`text-caption tabular-nums ${tone === "alert" ? "text-sev-5" : "text-smoke"}`}>{count}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- live view */

function withoutNavbar(url: string): string {
  if (/[?&]navbar=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}navbar=false`;
}

function LiveView({ lane, title, latest, allowLiveView }: { lane: LaneView; title: string; latest: StepEvent | null; allowLiveView: boolean }) {
  const sessionLive = allowLiveView && lane.liveViewUrl !== null && !isTerminalState(lane.state);

  if (sessionLive && lane.liveViewUrl) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-graphite">
        <iframe
          key={lane.liveViewUrl}
          src={withoutNavbar(lane.liveViewUrl)}
          title={`${title}: Browserbase live view`}
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
      <div className="relative overflow-hidden rounded-[12px]">
        <EvidenceImage
          source={{ screenshotKey: latest.payload.screenshotKey, bbox: latest.payload.bbox, viewport: latest.payload.viewport, payload: latest.payload }}
          label={latest.payload.targetLabel}
        />
        <Corner tone="still">{isTerminalState(lane.state) ? "Final" : "Latest"}</Corner>
      </div>
    );
  }

  // Placeholder until the live view URL arrives over the stream.
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-[12px] border border-hairline/10 bg-void/50 px-6 text-center">
      <p className="max-w-sm text-ui text-ash">{AGENT_BLURB}</p>
      <p className="flex items-center gap-2 text-caption text-smoke">
        {isTerminalState(lane.state) ? (
          (lane.statusMessage ?? "No browser session was recorded.")
        ) : (
          <>
            <Dot tone="idle" size={6} pulse />
            {lane.statusMessage ?? "Waiting for a Browserbase session"}
          </>
        )}
      </p>
    </div>
  );
}

function Corner({ children, tone }: { children: React.ReactNode; tone: "live" | "still" }) {
  return (
    <span
      className={`absolute left-2 inline-flex h-6 items-center gap-1.5 rounded-full border border-hairline/15 bg-void/70 px-2.5 text-caption text-bone backdrop-blur-[4px] ${
        tone === "live" ? "top-2" : "bottom-2"
      }`}
    >
      {tone === "live" && <Dot tone="bad" size={6} pulse />}
      {children}
    </span>
  );
}

/* ----------------------------------------------------------- current action */

export function targetText(step: StepEvent): string {
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

function CurrentAction({ lane, latest }: { lane: LaneView; latest: StepEvent | null }) {
  const finished = isTerminalState(lane.state);
  return (
    <div className="shrink-0 px-5 pb-3 pt-3">
      {latest ? (
        <div key={latest.seq} className="step-in">
          <p className="flex items-baseline gap-2.5 text-body leading-snug text-white">
            <span className="tag relative -top-0.5 shrink-0 text-bone">{ACTION_VERBS[latest.payload.actionType]}</span>
            <span className="min-w-0 break-words">{targetText(latest)}</span>
          </p>
          <p className="mt-1.5 line-clamp-2 text-ui italic leading-snug text-ash" title={latest.payload.rationale}>
            “{latest.payload.rationale}”
          </p>
        </div>
      ) : (
        <p className="text-body text-smoke">{finished ? "No actions were taken." : "Waiting for the first action"}</p>
      )}

      {finished ? (
        <p className="mt-2.5 flex items-start gap-2.5 rounded-ui border border-hairline/10 bg-white/3 px-3 py-2 text-ui leading-snug text-bone">
          <span className="mt-1.5 flex">
            <Dot tone={stateTone(lane.state)} size={7} />
          </span>
          {lane.done?.payload.summary ?? lane.statusMessage ?? (lane.state === "succeeded" ? "Task complete." : "Did not complete the task.")}
        </p>
      ) : (
        lane.state === "running" && (
          <div className="mt-2.5 h-0.5 w-full overflow-hidden rounded-full bg-hairline/8" title="Observing the page and planning the next action">
            <div className="wash wash-sweep h-full w-full" />
          </div>
        )
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
      className="step-in group flex items-baseline gap-3 rounded-ui px-2 py-1.5 text-caption transition-colors hover:bg-white/4"
      title={`${p.rationale}\n${p.url}${p.selector ? `\n${p.selector}` : ""}`}
    >
      <span className="w-5 shrink-0 text-right tabular-nums text-smoke">{number}</span>
      <span className="w-12 shrink-0 text-smoke">{ACTION_VERBS[p.actionType]}</span>
      <span className="min-w-0 flex-1 truncate text-bone">{targetText(step)}</span>
      {friction && (
        <span className="shrink-0" title={friction.payload.summary ?? categoryLabel(friction.payload.category)}>
          <SeverityBadge severity={friction.payload.severity} />
        </span>
      )}
      <span className={`shrink-0 tabular-nums ${slow ? "text-sev-4" : "text-smoke"}`} title={slow ? "Took more than five seconds" : undefined}>
        {formatDuration(p.durationMs)}
      </span>
      {startTs !== null && <span className="hidden w-10 shrink-0 text-right tabular-nums text-smoke 2xl:inline">+{Math.max(0, Math.round((step.ts - startTs) / 1000))}s</span>}
    </li>
  );
}

/* ------------------------------------------------------------------ friction */

function FrictionAlert({ friction, stepNumber }: { friction: FrictionEvent; stepNumber: number | null }) {
  const p = friction.payload;
  const style = SEVERITY_STYLES[p.severity];
  const hits = p.hitCount ?? 1;
  return (
    <article className="step-in rounded-ui border border-hairline/10 bg-white/3 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <SeverityBadge severity={p.severity} />
        <h4 className={`min-w-0 truncate text-body ${style.text}`}>{categoryLabel(p.category)}</h4>
        {hits > 1 && (
          <span className="shrink-0 rounded-full border border-hairline/15 px-2 text-caption tabular-nums text-bone" title="Times the agent ran into this">
            ×{hits}
          </span>
        )}
        <span className="ml-auto shrink-0 text-caption tabular-nums text-smoke">
          {stepNumber !== null && `step ${stepNumber} · `}
          {Math.round(p.confidence * 100)}%
        </span>
      </div>
      {p.summary && <p className="mt-1.5 text-ui leading-snug text-bone">{p.summary}</p>}
      <p className="mt-1 line-clamp-2 text-caption text-ash lg:[@media(max-height:860px)]:line-clamp-1" title={p.recommendation}>
        <span className="text-bone">Fix: </span>
        {p.recommendation}
      </p>
    </article>
  );
}
