import { useEffect, useRef, useState } from "react";
import type { ScanListItem } from "@friction/shared";
import { api } from "../lib/api";
import { shortUrl, timeAgo } from "../lib/format";
import { SCAN_STATUS } from "../lib/scan";
import { AgentAmbient } from "./AgentAmbient";
import { Chip } from "./badges";
import { HeroPreview } from "./HeroPreview";
import { ArrowRight, Plus, Sparkle } from "./icons";
import { ScanForm } from "./ScanForm";

interface Props {
  onOpenScan: (scanId: string) => void;
  /** Whether the floating nav currently sits over the hero. */
  onOverHero?: (over: boolean) => void;
  scrollerRef: React.RefObject<HTMLElement | null>;
}

type Probe<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "down" };

const HOW_IT_WORKS: { title: string; detail: string }[] = [
  {
    title: "Read the site",
    detail: "One browser session opens your URL and up to five pages from its navigation, keeping each page's title and accessibility tree.",
  },
  {
    title: "Pick the ten critical tasks",
    detail:
      "One model call reads those pages and ranks the five tasks the site exists for: revenue, conversion, finding key information and getting help. Each says why it matters and what the final page shows when it is done. Nothing logs in, pays or enters personal data.",
  },
  {
    title: "One isolated browser per task",
    detail:
      "The agent attempts every task in its own Browserbase session and context, so no cookies leak between them. Sessions come from one shared pool, most critical task first.",
  },
  {
    title: "Observe, plan, act",
    detail:
      "Every step starts with a screenshot and the accessibility tree. One model call picks a single action, the action runs, and the evidence is kept. Each run is capped at 15 steps.",
  },
  {
    title: "Detect friction deterministically",
    detail:
      "Nine pure detectors run after every step: dead clicks, navigation loops, retries, step budget, error messages, modal interrupts, long waits, keyboard traps and ambiguous labels. The model never decides whether something happened; it only writes the judgement.",
  },
  {
    title: "Verify the fixes",
    detail:
      "For each task's worst findings, Friction proposes a fix and re-runs the task in a fresh browser with it installed. A fix counts as verified only if the friction is gone; a pull request is opened only when you click.",
  },
  {
    title: "Merge, rank and fix",
    detail:
      "The same problem hit on several tasks becomes one issue: same kind of friction, same page, same element. Issues are ranked by severity, then by how many tasks hit them, each with its screenshot and what to fix. Review the complete scan from the graph and Results page.",
  },
];

export function Landing({ onOpenScan, onOverHero, scrollerRef }: Props) {
  const [scans, setScans] = useState<Probe<ScanListItem[]>>({ status: "loading" });
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
      .listScans()
      .then((body) => !cancelled && setScans({ status: "ok", value: body.scans }))
      .catch(() => !cancelled && setScans({ status: "down" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main ref={scrollerRef} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-y-none scroll-smooth">
      {/* ---------------------------------------------------------------- hero */}
      <section ref={hero} className="horizon relative isolate overflow-hidden rounded-b-panel">
        <div aria-hidden="true" className="horizon-scrim pointer-events-none absolute inset-0 -z-10" />
        <AgentAmbient />

        <div className="relative z-10 mx-auto max-w-300 px-4 pt-32 sm:px-6 sm:pt-40">
          <h1 className="max-w-[28ch] text-[clamp(44px,6.2vw,72px)] leading-[1.02] tracking-[-0.035em] text-white text-balance lg:max-w-none">
            <span className="block">Ship fast</span>
            <span className="block">
              <HeadlineTypewriter />
            </span>
          </h1>

          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-end gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="pb-10 lg:pb-14">
              <div className="dusk-pool">
                <ScanForm onStarted={onOpenScan} />
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
            Enter a URL. Friction reads the site, picks the five tasks that matter most, and has the agent attempt each one in an isolated Browserbase
            session on the live site. Findings from every run are merged into one ranked report with screenshot evidence.
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
          {scans.status === "ok" && scans.value.length > 0 && <p className="text-caption text-smoke">Up to five tasks per scan, one run each.</p>}
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
                        ) : scan.status === "cancelled" ? (
                          "Scan stopped"
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

function HeadlineTypewriter() {
  const [{ typedLength, selectionStart, phase }, setAnimation] = useState<{
    typedLength: number;
    selectionStart: number;
    phase: "waiting" | "typing" | "typed" | "selecting-word" | "word-selected" | "underlining" | "holding" | "selecting-line" | "line-selected";
  }>({ typedLength: 0, selectionStart: TYPEWRITER_TEXT.length, phase: "waiting" });
  const selectingWord = phase === "selecting-word" || phase === "word-selected";
  const selectingLine = phase === "selecting-line" || phase === "line-selected";
  const selecting = selectingWord || selectingLine;
  const selectionEnd = selectingWord ? FRICTION_END : TYPEWRITER_TEXT.length;
  const underlined = phase === "underlining" || phase === "holding" || selectingLine;
  const caretPosition = selecting ? selectionStart : phase === "underlining" ? FRICTION_END : typedLength;

  useEffect(() => {
    const delay = phase === "waiting" ? TYPEWRITER_START_DELAY_MS
      : phase === "typed" ? 300
      : phase === "selecting-word" ? 55
      : phase === "word-selected" ? 450
      : phase === "underlining" ? 700
      : phase === "holding" ? TYPEWRITER_HOLD_MS
      : phase === "line-selected" ? 650
      : phase === "selecting-line" ? 28
      : TYPEWRITER_STEP_MS;
    const timer = window.setTimeout(() => setAnimation((current) => {
      if (current.phase === "typed") return { ...current, selectionStart: FRICTION_END, phase: "selecting-word" };
      if (current.phase === "selecting-word") {
        const start = Math.max(FRICTION_START, current.selectionStart - 1);
        return { ...current, selectionStart: start, phase: start === FRICTION_START ? "word-selected" : "selecting-word" };
      }
      if (current.phase === "word-selected") return { ...current, phase: "underlining" };
      if (current.phase === "underlining") return { ...current, phase: "holding" };
      if (current.phase === "holding") return { ...current, selectionStart: TYPEWRITER_TEXT.length, phase: "selecting-line" };
      if (current.phase === "selecting-line") {
        const start = Math.max(0, current.selectionStart - 1);
        return { ...current, selectionStart: start, phase: start === 0 ? "line-selected" : "selecting-line" };
      }
      if (current.phase === "line-selected") {
        return { typedLength: 0, selectionStart: TYPEWRITER_TEXT.length, phase: "waiting" };
      }
      const length = current.typedLength + 1;
      return { ...current, typedLength: length, phase: length === TYPEWRITER_TEXT.length ? "typed" : "typing" };
    }), delay);
    return () => window.clearTimeout(timer);
  }, [phase, typedLength, selectionStart]);

  const renderCharacters = (start: number, end: number) => TYPEWRITER_TEXT.slice(start, end).split("").map((character, offset) => {
    const index = start + offset;
    const selected = selecting && index >= selectionStart && index < selectionEnd;
    const caretBefore = index === caretPosition;
    const caretAfter = caretPosition === TYPEWRITER_TEXT.length && index === caretPosition - 1;
    return (
      <span
        key={index}
        className={`hero-typewriter-character ${selected ? "hero-typewriter-character--selected" : ""} ${selected && index === selectionStart ? "hero-typewriter-character--selection-start" : ""} ${selected && index === selectionEnd - 1 ? "hero-typewriter-character--selection-end" : ""}`}
      >
        {caretBefore && <span className={`hero-typewriter-caret hero-typewriter-caret--before ${selecting ? "hero-typewriter-caret--selecting" : ""}`} />}
        <span style={{ visibility: index < typedLength ? "visible" : "hidden" }}>{character}</span>
        {caretAfter && <span className="hero-typewriter-caret" />}
      </span>
    );
  });

  return (
    <span className="hero-typewriter" data-phase={phase}>
      <span className="sr-only">{TYPEWRITER_TEXT}</span>
      <span aria-hidden="true">
        <span className="hero-typewriter-word">{renderCharacters(0, 7)}</span>
        {renderCharacters(7, 8)}
        <span className="hero-typewriter-word">{renderCharacters(8, 16)}</span>
        {renderCharacters(16, FRICTION_START)}
        <span className="hero-typewriter-word">
          <span className={`hero-typewriter-friction ${underlined ? "hero-typewriter-friction--done" : ""}`}>{renderCharacters(FRICTION_START, FRICTION_END)}</span>
          {renderCharacters(FRICTION_END, TYPEWRITER_TEXT.length)}
        </span>
      </span>
    </span>
  );
}

const TYPEWRITER_TEXT = "without shipping friction.";
const FRICTION_START = "without shipping ".length;
const FRICTION_END = FRICTION_START + "friction".length;
const TYPEWRITER_START_DELAY_MS = 500;
const TYPEWRITER_STEP_MS = 48;
const TYPEWRITER_HOLD_MS = 4200;
