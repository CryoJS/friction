import { useEffect, useRef, useState } from "react";
import type { ScanListItem } from "@friction/shared";
import { api } from "../lib/api";
import { shortUrl, timeAgo } from "../lib/format";
import { SCAN_STATUS } from "../lib/scan";
import { AgentAmbient } from "./AgentAmbient";
import { Chip } from "./badges";
import { HeroPreview } from "./HeroPreview";
import { ArrowRight, LogoMark } from "./icons";
import { ScanForm } from "./ScanForm";

interface Props {
  onOpenScan: (scanId: string) => void;
  /** Whether the floating nav currently sits over the hero. */
  onOverHero?: (over: boolean) => void;
  scrollerRef: React.RefObject<HTMLElement | null>;
}

type Probe<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "down" };

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

        <div className="relative z-10 mx-auto max-w-300 px-4 pt-40 sm:px-6 sm:pt-48">
          <h1 className="max-w-[28ch] text-[clamp(44px,6.2vw,72px)] leading-[1.02] tracking-[-0.035em] text-white text-balance lg:max-w-none">
            <span className="block">Ship fast</span>
            <span className="block">
              <HeadlineTypewriter />
            </span>
          </h1>

          <div className="mt-16 grid grid-cols-[minmax(0,1fr)] items-end gap-10 lg:grid-cols-2 lg:gap-14">
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

      {/* -------------------------------------------------------- recent scans */}
      <section id="scans" className="mx-auto max-w-300 scroll-mt-24 px-4 pb-24 pt-16 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-heading text-[32px] font-semibold leading-tight tracking-tight text-bone">Recent scans</h2>
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
            <LogoMark size={20} />
            Friction
          </span>
          <span>Built for Hack the North 2026</span>
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
