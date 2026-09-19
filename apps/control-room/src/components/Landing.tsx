import { useEffect, useRef, useState } from "react";
import { GOLDEN_RUN_ID, PERSONAS, type OrchestratorHealth, type PersonaId, type RunRecord } from "@friction/shared";
import { api } from "../lib/api";
import { shortUrl, timeAgo } from "../lib/format";
import { Chip, Dot, type Tone } from "./badges";
import { HeroPreview } from "./HeroPreview";
import { PERSONA_GLYPHS, Play, Plus, Sparkle } from "./icons";
import { RunForm, type StartedRun } from "./RunForm";

interface Props {
  onOpen: (runId: string, replay: boolean) => void;
  onStarted: (run: StartedRun) => void;
  /** Whether the floating nav currently sits over the hero. */
  onOverHero?: (over: boolean) => void;
}

type Probe<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "down" };

/** One line per persona for the hero; the full descriptions live in the control room. */
const PERSONA_LINES: Record<PersonaId, string> = {
  impatient: "gives up after two failed attempts.",
  cautious: "reads every label, thrown by modals.",
  keyboard: "Tab, Enter and arrows. Never the mouse.",
};

const HOW_IT_WORKS: { title: string; detail: string }[] = [
  {
    title: "Three isolated browsers",
    detail: "Each persona gets its own Browserbase session inside its own context, so no cookies leak between them. All three run at the same time.",
  },
  {
    title: "Observe the page",
    detail: "Every step starts with a screenshot and the accessibility tree, pruned to interactive elements and headings.",
  },
  {
    title: "Plan the next move",
    detail: "One model call reads the screenshot and picks a single action, in the persona's own voice. Each persona is capped at 15 steps.",
  },
  {
    title: "Act and keep the evidence",
    detail: "The action runs, the screenshot is stored, and the step streams straight into the control room.",
  },
  {
    title: "Detect friction deterministically",
    detail:
      "Nine pure detectors run after every step: dead clicks, navigation loops, retries, step budget, error messages, modal interrupts, long waits, keyboard traps and ambiguous labels. The model never decides whether something happened; it only writes the judgement.",
  },
  {
    title: "Rank what matters",
    detail: "Findings are ranked by severity, then confidence. Each one carries its screenshot with the target boxed, and what to fix.",
  },
  {
    title: "Replay anywhere",
    detail: "Any run plays back client-side from a single request. No orchestrator, no model, no wifi.",
  },
];

export function Landing({ onOpen, onStarted, onOverHero }: Props) {
  const [runs, setRuns] = useState<Probe<RunRecord[]>>({ status: "loading" });
  const [health, setHealth] = useState<Probe<OrchestratorHealth>>({ status: "loading" });
  const scroller = useRef<HTMLElement>(null);
  const hero = useRef<HTMLElement>(null);

  useEffect(() => {
    const main = scroller.current;
    if (!main || !onOverHero) return;
    let frame = 0;
    const check = (): void => {
      frame = 0;
      // The nav's lower edge sits 64px from the top of the viewport.
      onOverHero((hero.current?.getBoundingClientRect().bottom ?? 0) > 64);
    };
    const onScroll = (): void => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    check();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      onOverHero(true);
    };
  }, [onOverHero]);

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
    <main ref={scroller} className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth motion-reduce:scroll-auto">
      {/* ---------------------------------------------------------------- hero */}
      <section ref={hero} className="horizon relative isolate overflow-hidden rounded-b-panel">
        <div aria-hidden="true" className="horizon-scrim pointer-events-none absolute inset-0 -z-10" />

        <div className="mx-auto max-w-300 px-4 pt-24 sm:px-6">
          <ServiceStatus runs={runs} health={health} />

          <h1 className="mt-8 max-w-[21ch] text-[clamp(44px,6.2vw,72px)] leading-[1.02] tracking-[-0.035em] text-white text-balance lg:max-w-none">
            <span className="lg:block">Three users. One task. </span>
            <span className="lg:block">Every place your site fights back.</span>
          </h1>

          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-end gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="pb-10 lg:pb-14">
              <ul className="flex flex-col gap-3" aria-label="The three personas">
                {PERSONAS.map((persona) => {
                  const Glyph = PERSONA_GLYPHS[persona.id];
                  return (
                    <li key={persona.id} className="flex items-start gap-3 text-body text-bone">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-icon bg-white text-black">
                        <Glyph size={13} />
                      </span>
                      <span>
                        <span className="text-white">{persona.displayName}</span> <span className="text-bone/80">{PERSONA_LINES[persona.id]}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="dusk-pool mt-7">
                <RunForm onStarted={onStarted} />

                <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 px-1 text-ui text-white">
                  <span>No site handy?</span>
                  <button type="button" onClick={() => onOpen(GOLDEN_RUN_ID, true)} className="pill-ghost h-8 border-white/40 bg-void/45 text-white">
                    <Play size={12} />
                    Replay the golden run
                  </button>
                  <button type="button" onClick={() => onOpen(GOLDEN_RUN_ID, false)} className="pill-ghost h-8 border-white/40 bg-void/45 text-white" title="Watch the Worker stream the golden fixture over server-sent events">
                    Stream it over SSE
                  </button>
                </div>
              </div>
            </div>

            <div className="-mx-2 sm:mx-0">
              <HeroPreview />
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- how it works */}
      <section id="how" className="mx-auto grid max-w-300 scroll-mt-24 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:py-20">
        <div className="self-start lg:sticky lg:top-28">
          <h2 className="font-heading text-[32px] font-medium leading-[1.15] tracking-tight text-bone text-balance sm:text-heading">
            Every step is observed, planned, acted on and judged.
          </h2>
          <p className="mt-5 max-w-[46ch] text-subheading text-ash">
            Enter a URL and a task. Friction opens three isolated Browserbase sessions, one per persona, and lets each attempt the task on the live site. Friction is
            detected as it happens and ends up in a ranked report with screenshot evidence.
          </p>
        </div>

        <ol className="flex flex-col gap-5 lg:pt-2">
          {HOW_IT_WORKS.map((item, index) => (
            <li key={item.title}>
              <details className="group" open={index === 4}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-ui py-1 text-subheading text-bone transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
                  <span>{item.title}</span>
                  <span className="flex shrink-0 items-center gap-3 text-ash">
                    <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                    <Plus size={14} className="transition-transform duration-300 ease-out group-open:rotate-45" />
                  </span>
                </summary>
                <p className="max-w-[60ch] pb-1 pt-2 text-body text-ash">{item.detail}</p>
              </details>
            </li>
          ))}
        </ol>
      </section>

      {/* --------------------------------------------------------- recent runs */}
      <section id="runs" className="mx-auto max-w-300 scroll-mt-24 px-4 pb-24 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-heading text-[32px] font-semibold leading-tight tracking-tight text-bone">Recent runs</h2>
          {runs.status === "ok" && runs.value.length > 0 && <p className="text-caption text-smoke">Replay needs only the Worker. Open live reconnects to the stream.</p>}
        </div>

        <div className="relative mt-6 overflow-hidden rounded-card border border-hairline/10 bg-white/4">
          <div aria-hidden="true" className="wash absolute inset-x-0 top-0 h-px" style={{ backgroundPosition: "50% 0" }} />
          {runs.status === "loading" && <p className="px-6 py-6 text-body text-smoke">Loading runs…</p>}
          {runs.status === "down" && (
            <p className="px-6 py-6 text-body text-ash">
              The Worker is not answering, so past runs are unavailable. The golden run still plays: it is bundled into this app.
            </p>
          )}
          {runs.status === "ok" && runs.value.length === 0 && <p className="px-6 py-6 text-body text-ash">No runs yet. Start one above.</p>}
          {runs.status === "ok" && runs.value.length > 0 && (
            <ul>
              {runs.value.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-hairline/10 px-5 py-4 transition-colors last:border-b-0 hover:bg-white/3 sm:flex-nowrap sm:px-6"
                >
                  <span className="w-28 shrink-0">
                    <Chip tone={runTone(run.status)}>{run.status}</Chip>
                  </span>
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="truncate text-body text-bone" title={run.task}>
                      {run.task}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[13px] tracking-normal text-smoke">
                      {shortUrl(run.url)} · {run.id} · {timeAgo(run.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => onOpen(run.id, true)} className="pill-ghost">
                      <Play size={11} />
                      Replay
                    </button>
                    <button type="button" onClick={() => onOpen(run.id, false)} className="pill-ghost">
                      Open live
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className="mx-auto max-w-300 px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline/10 py-8 text-caption text-smoke">
        <span className="flex items-center gap-2">
          <Sparkle size={14} className="text-bone" />
          Friction. Built for Hack the North 2026.
        </span>
          <span>Every run replays with the wifi off.</span>
        </div>
      </footer>
    </main>
  );
}

function runTone(status: RunRecord["status"]): Tone {
  if (status === "completed") return "good";
  if (status === "running") return "glow";
  return "idle";
}

function probeTone(probe: Probe<unknown>): Tone {
  return probe.status === "ok" ? "good" : probe.status === "down" ? "bad" : "idle";
}

/** The status banner: what the demo laptop can reach right now. */
function ServiceStatus({ runs, health }: { runs: Probe<RunRecord[]>; health: Probe<OrchestratorHealth> }) {
  const mock = health.status === "ok" && health.value.mode !== "live";
  const orchestrator =
    health.status === "ok" ? `Orchestrator ${health.value.mode === "live" ? "live" : `in ${health.value.mode} mode`}` : health.status === "down" ? "Orchestrator offline" : "Orchestrator";
  const worker = runs.status === "ok" ? "Worker online" : runs.status === "down" ? "Worker offline" : "Worker";
  const title = health.status === "ok" && health.value.missingEnv.length > 0 ? `Mock mode. Missing: ${health.value.missingEnv.join(", ")}` : undefined;

  return (
    <div className="flex justify-center">
      <p
        role="status"
        title={title}
        className="glass inline-flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-nav border border-hairline/20 px-4 py-1.5 text-center text-ui text-bone"
      >
        <Sparkle size={14} className="shrink-0 text-white" />
        <span className="inline-flex items-center gap-2">
          <Dot tone={probeTone(runs)} size={7} />
          {worker}
        </span>
        <span className="inline-flex items-center gap-2">
          <Dot tone={mock ? "warn" : probeTone(health)} size={7} />
          {orchestrator}
        </span>
      </p>
    </div>
  );
}
