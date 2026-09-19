/**
 * The golden run: the demo safety net and the frontend's dev fixture.
 * Imported through here by all three apps so there is exactly one copy:
 *   worker        stream fallback when no live producer is attached
 *   control room  offline fallback when even the Worker is unreachable
 *   orchestrator  mock mode (no API keys yet)
 *
 * Kept out of the main entry point so importing "@friction/shared" stays light.
 */
import raw from "../../../fixtures/golden-run.json";
import { RunSnapshotSchema, type RunRecord, type RunSnapshot } from "./api";
import { compareEvents, type RunEvent } from "./events";

let cached: RunSnapshot | null = null;

/**
 * The fixture, validated once. If it ever fails validation we still return it
 * (and say so loudly): a slightly-off demo beats a crashed one.
 */
export function getGoldenRun(): RunSnapshot {
  if (cached) return cached;
  const parsed = RunSnapshotSchema.safeParse(raw);
  if (parsed.success) {
    cached = parsed.data;
  } else {
    console.error("[friction] fixtures/golden-run.json failed validation:", parsed.error.issues);
    cached = raw as unknown as RunSnapshot;
  }
  cached = { ...cached, events: [...cached.events].sort(compareEvents) };
  return cached;
}

export interface RebaseOptions {
  /** Present the fixture under this run id. */
  runId: string;
  /** Shift every timestamp so the first event happens at this time. */
  startTs?: number;
  /** Replace the run row (e.g. the real url/task the user typed). */
  run?: RunRecord | null;
}

/** The fixture re-labelled as another run, optionally shifted in time. */
export function rebaseGoldenRun(options: RebaseOptions): RunSnapshot {
  const golden = getGoldenRun();
  const firstTs = golden.events[0]?.ts ?? golden.run.createdAt;
  const shift = options.startTs === undefined ? 0 : options.startTs - firstTs;
  const { runId } = options;

  const events: RunEvent[] = golden.events.map((e) => ({ ...e, runId, ts: e.ts + shift }));
  const lastTs = events[events.length - 1]?.ts ?? golden.run.createdAt + shift;
  // The story (state, outcome, sessions) is the fixture's; identity and url/task may be the caller's.
  const run: RunRecord = {
    ...golden.run,
    id: runId,
    createdAt: golden.run.createdAt + shift,
    completedAt: golden.run.completedAt === null ? null : golden.run.completedAt + shift,
    ...(options.run ? { url: options.run.url, task: options.run.task, createdAt: options.run.createdAt, completedAt: options.run.completedAt ?? lastTs } : {}),
    status: "completed",
  };

  return { run, events, source: "fixture" };
}
