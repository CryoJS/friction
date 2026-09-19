import { useEffect, useRef, useState } from "react";
import { type RunRecord } from "@friction/shared";
import { api } from "../lib/api";
import { shortUrl, timeAgo } from "../lib/format";
import { AgentAmbient } from "./AgentAmbient";
import { Chip, type Tone } from "./badges";
import { HeroPreview } from "./HeroPreview";
import { Play, Plus, Sparkle } from "./icons";
import { RunForm, type StartedRun } from "./RunForm";

interface Props {
  onOpen: (runId: string, replay: boolean) => void;
  onStarted: (run: StartedRun) => void;
  /** Whether the floating nav currently sits over the hero. */
  onOverHero?: (over: boolean) => void;
  scrollerRef: React.RefObject<HTMLElement | null>;
}

type Probe<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "down" };

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
    title: "Plan, act and keep the evidence",
    detail: "One model call picks a single action in the persona's own voice. The action runs, the screenshot is stored, and the step streams straight into the control room. Each persona is capped at 15 steps.",
  },
  {
    title: "Detect friction deterministically",
    detail:
      "Nine pure detectors run after every step: dead clicks, navigation loops, retries, step budget, error messages, modal interrupts, long waits, keyboard traps and ambiguous labels. The model never decides whether something happened; it only writes the judgement.",
  },
  {
    title: "Rank findings and replay anywhere",
    detail: "Findings are ranked by severity and confidence, with screenshot evidence and what to fix. Any run can then play back client-side from a single request, even without the orchestrator, model or wifi.",
  },
];

export function Landing({ onOpen, onStarted, onOverHero, scrollerRef }: Props) {
  const [runs, setRuns] = useState<Probe<RunRecord[]>>({ status: "loading" });
  const hero = useRef<HTMLElement>(null);

  useEffect(() => {
    const main = scrollerRef.current;
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
  }, [onOverHero, scrollerRef]);

  useEffect(() => {
    let cancelled = false;
    api
      .listRuns()
      .then((body) => !cancelled && setRuns({ status: "ok", value: body.runs }))
      .catch(() => !cancelled && setRuns({ status: "down" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main ref={scrollerRef} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-y-none scroll-smooth motion-reduce:scroll-auto">
      {/* ---------------------------------------------------------------- hero */}
      <section ref={hero} className="horizon relative isolate overflow-hidden rounded-b-panel">
        <div aria-hidden="true" className="horizon-scrim pointer-events-none absolute inset-0 -z-10" />
        <AgentAmbient />

        <div className="relative z-10 mx-auto max-w-300 px-4 pt-32 sm:px-6 sm:pt-40">
          <h1 className="max-w-[21ch] text-[clamp(44px,6.2vw,72px)] leading-[1.02] tracking-[-0.035em] text-white text-balance lg:max-w-none">
            <span className="lg:block">
              <HeadlineTarget className="hero-headline-target--users">Three users.</HeadlineTarget>{" "}
              <HeadlineTarget className="hero-headline-target--task">One task.</HeadlineTarget>
            </span>
            <span className="lg:block">
              <HeadlineTarget className="hero-headline-target--site">Every place</HeadlineTarget>{" "}
              your site fights back.
            </span>
          </h1>

          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-end gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="pb-10 lg:pb-14">
              <div className="dusk-pool">
                <RunForm onStarted={onStarted} />
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

function HeadlineTarget({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`hero-headline-target ${className}`}>
      <span className="relative z-[1]">{children}</span>
      <span className="hero-headline-selection" aria-hidden="true">
        <span className="hero-headline-handle hero-headline-handle--top-left" />
        <span className="hero-headline-handle hero-headline-handle--top-right" />
        <span className="hero-headline-handle hero-headline-handle--bottom-left" />
        <span className="hero-headline-handle hero-headline-handle--bottom-right" />
      </span>
      <span className="hero-headline-label" aria-hidden="true">
        <span className="hero-headline-label-dot" />
        agent focus
      </span>
      <span className="hero-headline-cursor" aria-hidden="true" />
    </span>
  );
}

function runTone(status: RunRecord["status"]): Tone {
  if (status === "completed") return "good";
  if (status === "running") return "glow";
  return "idle";
}
