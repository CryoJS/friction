import { FRICTION_LABELS, scanNodeId, type ScanIssue } from "@friction/shared";
import { EvidenceImage } from "../EvidenceImage";
import { SEVERITY_STYLES, SeverityBadge, categoryLabel } from "../badges";
import { Plus } from "../icons";

interface Props {
  issue: ScanIssue;
  /** 1-based position in the site report's ranking. */
  rank: number;
  onSelect: (nodeId: string) => void;
}

/**
 * One merged issue, collapsed to a single scannable row: rank, severity,
 * what it is, how widespread. Opening it shows the evidence, the three
 * one-line bullets (what, cost, fix) and every run that hit it.
 */
export function IssueCard({ issue, rank, onSelect }: Props) {
  const style = SEVERITY_STYLES[issue.severity];
  const bullets = [
    issue.summary && { label: null, text: issue.summary },
    issue.whyItMatters && { label: "Cost", text: issue.whyItMatters },
    { label: "Fix", text: issue.recommendation },
  ].filter((bullet): bullet is { label: string | null; text: string } => Boolean(bullet));

  return (
    <details className="group overflow-hidden rounded-card border border-hairline/10 bg-white/4">
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
