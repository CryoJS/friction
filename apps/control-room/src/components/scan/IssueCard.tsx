import { useEffect, useRef } from "react";
import { FRICTION_LABELS, scanNodeId, type FixRecord, type ScanIssue } from "@friction/shared";
import { EvidenceImage } from "../EvidenceImage";
import { InjectionBadge, SEVERITY_STYLES, SeverityBadge, StageBadge, categoryLabel } from "../badges";
import { ArrowUpRight, Plus } from "../icons";

interface Props {
  issue: ScanIssue;
  /** 1-based position in the site report's ranking. */
  rank: number;
  onSelect: (nodeId: string) => void;
  onOpenAnnotation?: (findingId: string) => void;
  annotationFindingId?: string;
  /**
   * This issue's fix in the open task's run, once one has been proposed. What
   * the card shows is the fix's own state, not the model's advice: the stage it
   * reached, how the patch was installed for the verify run, and the session
   * that proved (or failed to prove) it.
   */
  fix?: FixRecord | null;
  /** True when something outside this card (e.g. its satellite on the orbit graph) asked it to open and come into view. */
  forceOpen?: boolean;
}

/**
 * One merged issue, collapsed to a single scannable row: rank, severity,
 * what it is, how widespread. Opening it shows the evidence, the three
 * one-line bullets (what, cost, fix) and every run that hit it.
 */
export function IssueCard({
  issue,
  rank,
  onSelect,
  onOpenAnnotation,
  annotationFindingId = issue.occurrences[0]?.findingId,
  fix = null,
  forceOpen = false,
}: Props) {
  const style = SEVERITY_STYLES[issue.severity];
  const ref = useRef<HTMLDetailsElement>(null);
  const bullets = [
    issue.summary && { label: null, text: issue.summary },
    issue.whyItMatters && { label: "Cost", text: issue.whyItMatters },
    { label: "Fix", text: issue.recommendation },
  ].filter((bullet): bullet is { label: string | null; text: string } => Boolean(bullet));

  // A satellite click on the orbit graph asks this specific card to open and scroll into view. This
  // nudges the DOM once, imperatively, rather than binding `open` as a controlled prop: the polling
  // re-renders this component every couple of seconds, and a controlled `open` would fight back every
  // time the viewer manually closed a card that was still the focused one.
  useEffect(() => {
    if (!forceOpen || !ref.current) return;
    ref.current.open = true;
    ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [forceOpen]);

  return (
    <details ref={ref} className="group overflow-hidden rounded-card border border-hairline/10 bg-white/4">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-white/4 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="font-heading text-subheading tabular-nums leading-none text-ash">{String(rank).padStart(2, "0")}</span>
            <h3 className="truncate font-heading text-subheading leading-none text-white" title={FRICTION_LABELS[issue.category].blurb}>
              {categoryLabel(issue.category)}
            </h3>
            <SeverityBadge severity={issue.severity} />
          </div>
          <p className="mt-1.5 truncate text-caption text-smoke">
            <span className="tabular-nums text-bone">
              {issue.runsHit}/{issue.totalRuns}
            </span>{" "}
            runs
            {issue.page && (
              <>
                {" · "}
                <span className="font-mono tracking-normal">{issue.page}</span>
              </>
            )}
          </p>
        </div>
        <Plus size={14} className="shrink-0 text-ash transition-transform duration-300 ease-out group-open:rotate-45" />
      </summary>

      <div className="space-y-4 border-t border-hairline/10 p-5">
        {onOpenAnnotation && annotationFindingId && (
          <button
            type="button"
            onClick={() => onOpenAnnotation(annotationFindingId)}
            className="inline-flex items-center gap-1.5 text-caption text-smoke transition-colors hover:text-white"
          >
            <ArrowUpRight size={13} />
            View in annotations
          </button>
        )}

        {issue.evidence ? (
          <div className="overflow-hidden rounded-xl">
            <EvidenceImage
              source={{ screenshotKey: issue.evidence.screenshotKey, bbox: issue.evidence.bbox, viewport: issue.evidence.viewport }}
              boxClass={style.box}
              label={issue.evidence.targetLabel}
            />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl bg-graphite text-caption text-smoke">No evidence captured.</div>
        )}

        <ul className="space-y-2">
          {bullets.map((bullet) => (
            <li key={bullet.label ?? "what"} className="flex gap-2.5 text-ui leading-snug text-ash">
              <span aria-hidden="true" className={`mt-2 h-1 w-1 shrink-0 rounded-full ${style.dot}`} />
              <span>
                {bullet.label && <span className="text-bone">{bullet.label}: </span>}
                {bullet.text}
              </span>
            </li>
          ))}
        </ul>

        {fix && (
          <section aria-label="Proposed fix" className="rounded-xl border border-hairline/10 bg-white/3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StageBadge stage={fix.stage} />
              {fix.injection && <InjectionBadge injection={fix.injection} />}
            </div>
            {fix.note && <p className="mt-2.5 text-ui leading-snug text-ash">{fix.note}</p>}
            {(fix.liveViewUrl || fix.replayUrl) && (
              <div className="mt-2.5 flex flex-wrap gap-3">
                {fix.liveViewUrl && (
                  <a href={fix.liveViewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-caption text-smoke transition-colors hover:text-white">
                    <ArrowUpRight size={13} />
                    Watch the verify session
                  </a>
                )}
                {fix.replayUrl && (
                  <a href={fix.replayUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-caption text-smoke transition-colors hover:text-white">
                    <ArrowUpRight size={13} />
                    Replay
                  </a>
                )}
              </div>
            )}
          </section>
        )}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tasks that hit this issue">
          {issue.taskIndexes.map((taskIndex) => (
            <button
              key={taskIndex}
              type="button"
              onClick={() => onSelect(scanNodeId({ kind: "task", index: taskIndex }))}
              className="pill-ghost h-7 px-2.5 text-caption tabular-nums"
            >
              Task {taskIndex + 1}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}
