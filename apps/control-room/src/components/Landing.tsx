import { useEffect, useState } from "react";
import { GOLDEN_RUN_ID, PERSONAS, type OrchestratorHealth, type RunRecord } from "@friction/shared";
import { api } from "../lib/api";
import { shortUrl, timeAgo } from "../lib/format";
import { Chip } from "./badges";

interface Props {
  onOpen: (runId: string, replay: boolean) => void;
}

type Probe<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "down" };

export function Landing({ onOpen }: Props) {
  const [runs, setRuns] = useState<Probe<RunRecord[]>>({ status: "loading" });
  const [health, setHealth] = useState<Probe<OrchestratorHealth>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .listRuns()
      .then((body) => !cancelled && setRuns({ status: "ok", value: body.runs }))
      .catch(() => !cancelled && setRuns({ status: "down" }));
    api
      .orchestratorHealth()
      .then((body) => !cancelled && setHealth({ status: "ok", value: body }))
      .catch(() => !cancelled && setHealth({ status: "down" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="pane flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Three users. One task. Every place your site fights back.</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Enter a URL and a task above. Friction opens three isolated Browserbase sessions, one per persona, and lets each attempt the task on the live site. Friction
          is detected as it happens and ends up in a ranked report with screenshot evidence.
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {PERSONAS.map((persona) => (
            <div key={persona.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">{persona.displayName}</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{persona.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(GOLDEN_RUN_ID, true)}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            Replay the golden run
          </button>
          <button
            type="button"
            onClick={() => onOpen(GOLDEN_RUN_ID, false)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
          >
            Stream it over SSE
          </button>
          <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
            <Status label="Worker" state={runs.status === "loading" ? "loading" : runs.status === "ok" ? "up" : "down"} />
            <Status
              label={health.status === "ok" ? `Orchestrator (${health.value.mode})` : "Orchestrator"}
              state={health.status === "loading" ? "loading" : health.status === "ok" ? "up" : "down"}
              title={health.status === "ok" && health.value.missingEnv.length > 0 ? `Mock mode. Missing: ${health.value.missingEnv.join(", ")}` : undefined}
            />
          </span>
        </div>

        <section className="mt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Recent runs</h2>
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {runs.status === "loading" && <p className="px-3 py-3 text-xs text-slate-400">Loading…</p>}
            {runs.status === "down" && (
              <p className="px-3 py-3 text-xs text-slate-500">
                The Worker is not answering, so past runs are unavailable. The golden run above still plays: it is bundled into this app.
              </p>
            )}
            {runs.status === "ok" && runs.value.length === 0 && <p className="px-3 py-3 text-xs text-slate-400">No runs yet. Start one above.</p>}
            {runs.status === "ok" &&
              runs.value.map((run) => (
                <div key={run.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50">
                  <Chip tone={run.status === "completed" ? "emerald" : run.status === "running" ? "indigo" : "slate"}>{run.status}</Chip>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-900">{run.task}</p>
                    <p className="truncate font-mono text-[11px] text-slate-500">
                      {shortUrl(run.url)} · {run.id} · {timeAgo(run.createdAt)}
                    </p>
                  </div>
                  <button type="button" onClick={() => onOpen(run.id, true)} className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-300">
                    Replay
                  </button>
                  <button type="button" onClick={() => onOpen(run.id, false)} className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-300">
                    Open live
                  </button>
                </div>
              ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Status({ label, state, title }: { label: string; state: "loading" | "up" | "down"; title?: string }) {
  const colour = state === "up" ? "bg-emerald-500" : state === "down" ? "bg-red-500" : "bg-slate-300 animate-pulse";
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <span className={`h-2 w-2 rounded-full ${colour}`} />
      {label}
    </span>
  );
}
