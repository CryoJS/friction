import { useEffect, useRef, useState } from "react";
import { GOLDEN_RUN_ID, PERSONAS, type OrchestratorHealth, type PersonaId, type ScanListItem } from "@friction/shared";
import { api } from "../lib/api";
import { shortUrl, timeAgo } from "../lib/format";
import { SCAN_STATUS } from "../lib/scan";
import { Chip, Dot, type Tone } from "./badges";
import { HeroPreview } from "./HeroPreview";
import { ArrowRight, PERSONA_GLYPHS, Play, Plus, Sparkle } from "./icons";
import { ScanForm } from "./ScanForm";

interface Props {
  onOpenScan: (scanId: string) => void;
  onOpenRun: (runId: string, replay: boolean) => void;
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
    title: "Read the site",
    detail: "One browser session opens your URL and up to five pages from its navigation, keeping each page's title and accessibility tree.",
  },
  {
    title: "Pick the ten critical tasks",
    detail:
      "One model call reads those pages and ranks the ten tasks the site exists for: revenue, conversion, finding key information and getting help. Each says why it matters and what the final page shows when it is done. Nothing logs in, pays or enters personal data.",
  },
  {
    title: "Thirty isolated browsers",
    detail:
      "Every task runs with all three personas, each in its own Browserbase session and context, so no cookies leak between them. Sessions come from one shared pool, most critical task first.",
  },
  {
    title: "Observe, plan, act",
    detail:
      "Every step starts with a screenshot and the accessibility tree. One model call picks a single action in the persona's own voice, the action runs, and the evidence is kept. Each persona is capped at 15 steps.",
  },
  {
    title: "Detect friction deterministically",
    detail:
      "Nine pure detectors run after every step: dead clicks, navigation loops, retries, step budget, error messages, modal interrupts, long waits, keyboard traps and ambiguous labels. The model never decides whether something happened; it only writes the judgement.",
  },
  {
    title: "Merge and rank",
    detail:
      "The same problem hit by several runs becomes one issue: same kind of friction, same page, same element. Issues are ranked by severity, then by how many of the thirty runs hit them, each with its screenshot and what to fix.",
  },
  {
    title: "Replay anywhere",
    detail: "Any single run plays back client-side from one request. No orchestrator, no model, no wifi.",
  },
];

export function Landing({ onOpenScan, onOpenRun, onOverHero }: Props) {
  const [scans, setScans] = useState<Probe<ScanListItem[]>>({ status: "loading" });
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
      .listScans()
      .then((body) => !cancelled && setScans({ status: "ok", value: body.scans }))
      .catch(() => !cancelled && setScans({ status: "down" }));
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
          <ServiceStatus scans={scans} health={health} />

          <h1 className="mt-8 max-w-[21ch] text-[clamp(40px,5.2vw,64px)] leading-[1.04] tracking-[-0.035em] text-white text-balance lg:max-w-none">
            <span className="lg:block">Autonomous QA that finds the flaw, </span>
            <span className="lg:block">writes the fix, and opens the PR</span>
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
                <ScanForm onStarted={onOpenScan} onReplayGolden={() => onOpenRun(GOLDEN_RUN_ID, true)} />

                <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 px-1 text-ui text-white">
                  <span>No site handy?</span>
                  <button type="button" onClick={() => onOpenRun(GOLDEN_RUN_ID, true)} className="pill-ghost h-8 border-white/40 bg-void/45 text-white">
                    <Play size={12} />
                    Replay the golden run
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenRun(GOLDEN_RUN_ID, false)}
                    className="pill-ghost h-8 border-white/40 bg-void/45 text-white"
                    title="Watch the Worker stream the golden fixture over server-sent events"
                  >
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
            Enter a URL. Friction reads the site, picks the ten tasks that matter most, and has three personas attempt each one in isolated Browserbase
            sessions on the live site. Findings from all thirty runs are merged into one ranked report with screenshot evidence.
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

      {/* -------------------------------------------------------- recent scans */}
      <section id="scans" className="mx-auto max-w-300 scroll-mt-24 px-4 pb-24 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-heading text-[32px] font-semibold leading-tight tracking-tight text-bone">Recent scans</h2>
          {scans.status === "ok" && scans.value.length > 0 && <p className="text-caption text-smoke">Ten tasks per scan, three personas each.</p>}
        </div>

        <div className="relative mt-6 overflow-hidden rounded-card border border-hairline/10 bg-white/4">
          <div aria-hidden="true" className="wash absolute inset-x-0 top-0 h-px" style={{ backgroundPosition: "50% 0" }} />
          {scans.status === "loading" && <p className="px-6 py-6 text-body text-smoke">Loading scans…</p>}
          {scans.status === "down" && (
            <p className="px-6 py-6 text-body text-ash">The Worker is not answering, so past scans are unavailable. The golden run still plays: it is bundled into this app.</p>
          )}
          {scans.status === "ok" && scans.value.length === 0 && <p className="px-6 py-6 text-body text-ash">No scans yet. Start one above.</p>}
          {scans.status === "ok" && scans.value.length > 0 && (
            <ul>
              {scans.value.map((scan) => {
                const status = SCAN_STATUS[scan.status];
                return (
                  <li key={scan.id} className="border-b border-hairline/10 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => onOpenScan(scan.id)}
                      className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left transition-colors hover:bg-white/3 sm:flex-nowrap sm:px-6"
                    >
                      <span className="w-28 shrink-0">
                        <Chip tone={status.tone}>{status.label}</Chip>
                      </span>
                      <span className="min-w-0 flex-1 basis-60">
                        <span className="block truncate font-mono text-body tracking-normal text-bone group-hover:text-white" title={scan.url}>
                          {shortUrl(scan.url)}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-caption tracking-normal text-smoke">
                          {scan.id} · {timeAgo(scan.createdAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-ui tabular-nums text-ash">
                        {scan.tasksTotal > 0 ? (
                          <>
                            <span className="text-white">
                              {scan.tasksPassed}/{scan.tasksTotal}
                            </span>{" "}
                            tasks passed
                          </>
                        ) : scan.status === "failed" ? (
                          "No tasks ran"
                        ) : (
                          "Reading the site"
                        )}
                      </span>
                      <ArrowRight size={16} className="shrink-0 text-smoke transition-colors group-hover:text-white" />
                    </button>
                  </li>
                );
              })}
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

function probeTone(probe: Probe<unknown>): Tone {
  return probe.status === "ok" ? "good" : probe.status === "down" ? "bad" : "idle";
}

/** The status banner: what the demo laptop can reach right now. */
function ServiceStatus({ scans, health }: { scans: Probe<ScanListItem[]>; health: Probe<OrchestratorHealth> }) {
  const mock = health.status === "ok" && health.value.mode !== "live";
  const orchestrator =
    health.status === "ok" ? `Orchestrator ${health.value.mode === "live" ? "live" : `in ${health.value.mode} mode`}` : health.status === "down" ? "Orchestrator offline" : "Orchestrator";
  const worker = scans.status === "ok" ? "Worker online" : scans.status === "down" ? "Worker offline" : "Worker";
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
          <Dot tone={probeTone(scans)} size={7} />
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
