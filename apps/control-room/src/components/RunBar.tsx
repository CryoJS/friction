import type { Connection, Origin, ReplayControls as Controls } from "../hooks/useRunStream";
import { REPLAY_SPEEDS } from "../hooks/useRunStream";
import { formatElapsed, shortUrl } from "../lib/format";
import { summarize, type RunSummary, type RunView } from "../lib/runState";
import { Chip, Dot, type Tone } from "./badges";
import { ArrowUpRight, Pause, Play, Restart } from "./icons";

interface Props {
  view: RunView;
  origin: Origin | null;
  connection: Connection;
  elapsedMs: number | null;
  replay: Controls | null;
  onToggleReplay: () => void;
  isReplay: boolean;
}

const SUMMARY_TONES: Record<RunSummary["tone"], Tone> = {
  neutral: "idle",
  active: "glow",
  good: "good",
  bad: "bad",
  mixed: "warn",
};

const ORIGIN_CHIPS: Record<Origin, { label: string; tone: Tone; title: string }> = {
  live: { label: "Live", tone: "glow", title: "Streaming from a live producer" },
  fixture: { label: "Fixture stream", tone: "warn", title: "No producer attached: the Worker is streaming fixtures/golden-run.json" },
  replay: { label: "Replay", tone: "good", title: "Played back client-side from GET /api/runs/:id. No live network." },
  bundled: { label: "Offline fixture", tone: "warn", title: "Worker unreachable: playing the golden run bundled into this app" },
};

/** The run's identity and clock, sitting on the canvas under the floating nav. */
export function RunBar({ view, origin, connection, elapsedMs, replay, onToggleReplay, isReplay }: Props) {
  const summary = summarize(view);
  const run = view.run;

  return (
    <div className="shrink-0 px-4 pt-20 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[340px]">
          <div className="flex min-w-0 items-center gap-2.5">
            {origin && (
              <span title={ORIGIN_CHIPS[origin].title} className="shrink-0">
                <Chip tone={ORIGIN_CHIPS[origin].tone}>{ORIGIN_CHIPS[origin].label}</Chip>
              </span>
            )}
            {run ? (
              <a
                href={run.url}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex min-w-0 items-center gap-1 font-mono text-[13px] tracking-normal text-smoke transition-colors hover:text-white"
                title={run.url}
              >
                <span className="truncate">{shortUrl(run.url)}</span>
                <ArrowUpRight size={13} className="shrink-0 opacity-60 group-hover:opacity-100" />
              </a>
            ) : (
              <span className="font-mono text-[13px] tracking-normal text-smoke">{view.runId}</span>
            )}
            <ConnectionDot connection={connection} />
          </div>
          <h1 className="mt-1.5 truncate font-heading text-heading-sm font-medium tracking-[-0.02em] text-bone max-sm:line-clamp-2 max-sm:whitespace-normal" title={run?.task}>
            {run?.task ?? "Loading run"}
          </h1>
        </div>

        {(replay || !isReplay) && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
            {replay ? (
              <ReplayStrip controls={replay} />
            ) : (
              <span className="mr-1 text-caption text-smoke">
                {summary.stepCount} steps · {summary.frictionCount} friction findings so far
              </span>
            )}
            <button
              type="button"
              onClick={onToggleReplay}
              className="pill-ghost shrink-0 max-sm:hidden"
              title={isReplay ? "Reconnect to the live stream" : "Fetch the run once and play it back locally (works with the orchestrator dead)"}
            >
              {isReplay ? "Switch to live" : "Replay this run"}
            </button>
          </div>
        )}

        <div className="shrink-0 max-sm:flex max-sm:w-full max-sm:items-end max-sm:justify-between max-sm:gap-3">
          <div className="text-right max-sm:text-left">
            <div className="font-mono text-[32px] leading-none tabular-nums tracking-[-0.02em] text-white" title="Elapsed">
              {formatElapsed(elapsedMs)}
            </div>
            <div className="mt-1.5 flex items-center justify-end gap-2 text-caption text-ash max-sm:justify-start">
              <Dot tone={SUMMARY_TONES[summary.tone]} size={7} />
              {summary.label}
            </div>
          </div>
          {(replay || !isReplay) && (
            <button type="button" onClick={onToggleReplay} className="pill-ghost shrink-0 sm:hidden">
              {isReplay ? "Switch to live" : "Replay this run"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionDot({ connection }: { connection: Connection }) {
  const styles: Record<Connection, { tone: Tone; pulse?: boolean; label: string }> = {
    idle: { tone: "idle", label: "Not connected" },
    connecting: { tone: "warn", pulse: true, label: "Connecting" },
    open: { tone: "good", label: "Stream connected" },
    reconnecting: { tone: "warn", pulse: true, label: "Stream dropped, reconnecting" },
    ended: { tone: "idle", label: "Stream complete" },
    offline: { tone: "bad", label: "Worker unreachable" },
    local: { tone: "good", label: "Local playback, no network" },
  };
  const style = styles[connection];
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-caption text-smoke" title={style.label}>
      <Dot tone={style.tone} size={6} pulse={style.pulse} />
      <span className="hidden 2xl:inline">{style.label}</span>
      <span className="sr-only 2xl:hidden">{style.label}</span>
    </span>
  );
}

function ReplayStrip({ controls }: { controls: Controls }) {
  const progress = controls.total > 0 ? (controls.index / controls.total) * 100 : 0;
  return (
    <div className="glass flex min-w-0 items-center gap-2 rounded-full border border-hairline/15 p-1 pr-2 max-sm:w-full sm:w-[480px]">
      <button
        type="button"
        onClick={controls.playing ? controls.pause : controls.play}
        className="pill-cta h-8 w-10 shrink-0 px-0 text-ui sm:w-[92px] sm:px-3"
        aria-label={controls.playing ? "Pause replay" : controls.atEnd ? "Replay from the start" : "Play replay"}
      >
        {controls.playing ? <Pause size={13} /> : <Play size={12} />}
        <span className="hidden sm:inline">{controls.playing ? "Pause" : controls.atEnd ? "Replay" : "Play"}</span>
      </button>
      <button type="button" onClick={controls.restart} className="pill-ghost h-8 w-8 shrink-0 px-0" aria-label="Restart replay" title="Restart">
        <Restart size={14} />
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
        className="scrubber min-w-16 flex-1"
        style={{ "--progress": `${progress}%` } as React.CSSProperties}
        aria-label="Replay position"
      />
      <span className="hidden w-12 shrink-0 text-right font-mono text-[12px] sm:inline tabular-nums tracking-normal text-smoke">
        {controls.index}/{controls.total}
      </span>
      <div className="flex shrink-0 items-center" role="group" aria-label="Replay speed">
        {REPLAY_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => controls.setSpeed(speed)}
            aria-pressed={controls.speed === speed}
            className={`h-7 min-w-8 rounded-full px-2 text-[13px] tabular-nums transition-colors ${
              controls.speed === speed ? "bg-white/12 text-white" : "text-smoke hover:text-white"
            }`}
          >
            {speed}×
          </button>
        ))}
      </div>
    </div>
  );
}
