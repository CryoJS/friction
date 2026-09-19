import { PERSONA_IDS } from "@friction/shared";
import type { Connection, Origin, ReplayControls as Controls } from "../hooks/useRunStream";
import { REPLAY_SPEEDS } from "../hooks/useRunStream";
import { formatElapsed, shortUrl } from "../lib/format";
import { summarize, type RunView } from "../lib/runState";
import type { Tab } from "../lib/useQuery";
import { Chip, StateBadge } from "./badges";

interface Props {
  view: RunView;
  origin: Origin | null;
  connection: Connection;
  elapsedMs: number | null;
  replay: Controls | null;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onToggleReplay: () => void;
  isReplay: boolean;
}

const TONES = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  active: "bg-blue-50 text-blue-700 ring-blue-200",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
  mixed: "bg-amber-50 text-amber-800 ring-amber-200",
} as const;

const ORIGIN_CHIPS: Record<Origin, { label: string; tone: "slate" | "indigo" | "amber" | "emerald"; title: string }> = {
  live: { label: "Live", tone: "emerald", title: "Streaming from a live producer" },
  fixture: { label: "Fixture stream", tone: "amber", title: "No producer attached: the Worker is streaming fixtures/golden-run.json" },
  replay: { label: "Replay", tone: "indigo", title: "Played back client-side from GET /api/runs/:id. No live network." },
  bundled: { label: "Offline fixture", tone: "amber", title: "Worker unreachable: playing the golden run bundled into this app" },
};

export function RunBar({ view, origin, connection, elapsedMs, replay, tab, onTab, onToggleReplay, isReplay }: Props) {
  const summary = summarize(view);
  const run = view.run;

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex items-center gap-2">
            {origin && <span title={ORIGIN_CHIPS[origin].title}><Chip tone={ORIGIN_CHIPS[origin].tone}>{ORIGIN_CHIPS[origin].label}</Chip></span>}
            {run ? (
              <a href={run.url} target="_blank" rel="noreferrer" className="truncate font-mono text-xs text-slate-600 hover:text-indigo-600 hover:underline" title={run.url}>
                {shortUrl(run.url)}
              </a>
            ) : (
              <span className="font-mono text-xs text-slate-400">{view.runId}</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm font-medium text-slate-900" title={run?.task}>
            {run?.task ?? "Loading run"}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {PERSONA_IDS.map((id) => (
            <StateBadge key={id} state={view.personas[id].state} prefix={view.personas[id].def.displayName.split(" ")[0]} />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-lg font-semibold tabular-nums leading-none text-slate-900">{formatElapsed(elapsedMs)}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">elapsed</div>
          </div>
          <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONES[summary.tone]}`}>{summary.label}</span>
          <ConnectionDot connection={connection} />
        </div>

        <nav className="flex items-center rounded-md bg-slate-100 p-0.5 text-xs font-medium">
          <TabButton active={tab === "room"} onClick={() => onTab("room")}>
            Control room
          </TabButton>
          <TabButton active={tab === "report"} onClick={() => onTab("report")}>
            Report
            {summary.frictionCount > 0 && <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">{summary.frictionCount}</span>}
          </TabButton>
        </nav>
      </div>

      {(replay || !isReplay) && (
        <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-1.5">
          {replay ? <ReplayStrip controls={replay} /> : <span className="text-[11px] text-slate-500">{summary.stepCount} steps · {summary.frictionCount} friction findings so far</span>}
          <button
            type="button"
            onClick={onToggleReplay}
            className="ml-auto shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
            title={isReplay ? "Reconnect to the live stream" : "Fetch the run once and play it back locally (works with the orchestrator dead)"}
          >
            {isReplay ? "Switch to live stream" : "Replay this run"}
          </button>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center rounded px-3 py-1 transition-colors ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
    >
      {children}
    </button>
  );
}

function ConnectionDot({ connection }: { connection: Connection }) {
  const styles: Record<Connection, { colour: string; label: string }> = {
    idle: { colour: "bg-slate-300", label: "Not connected" },
    connecting: { colour: "bg-amber-400 animate-pulse", label: "Connecting" },
    open: { colour: "bg-emerald-500", label: "Stream connected" },
    reconnecting: { colour: "bg-amber-500 animate-pulse", label: "Stream dropped, reconnecting" },
    ended: { colour: "bg-slate-400", label: "Stream complete" },
    offline: { colour: "bg-red-500", label: "Worker unreachable" },
    local: { colour: "bg-indigo-500", label: "Local playback, no network" },
  };
  const style = styles[connection];
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-500" title={style.label}>
      <span className={`h-2 w-2 rounded-full ${style.colour}`} />
      <span className="hidden 2xl:inline">{style.label}</span>
    </span>
  );
}

function ReplayStrip({ controls }: { controls: Controls }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        onClick={controls.playing ? controls.pause : controls.play}
        className="w-16 shrink-0 rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-500"
      >
        {controls.playing ? "Pause" : controls.atEnd ? "Replay" : "Play"}
      </button>
      <button type="button" onClick={controls.restart} className="shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:text-slate-900">
        Restart
      </button>
      <input
        type="range"
        min={0}
        max={controls.total}
        value={controls.index}
        onChange={(event) => {
          controls.pause();
          controls.seek(Number(event.target.value));
        }}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-indigo-600"
        aria-label="Replay position"
      />
      <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-500">
        {controls.index}/{controls.total}
      </span>
      <div className="flex shrink-0 items-center rounded border border-slate-200 bg-white p-0.5">
        {REPLAY_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => controls.setSpeed(speed)}
            className={`rounded px-1.5 text-[11px] font-medium tabular-nums ${controls.speed === speed ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"}`}
          >
            {speed}×
          </button>
        ))}
      </div>
    </div>
  );
}
