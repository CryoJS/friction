import { FRICTION_LABELS, scanNodeId, type ScanIssue } from "@friction/shared";
import { EvidenceImage } from "../EvidenceImage";
import { SEVERITY_STYLES, SeverityBadge, categoryLabel } from "../badges";

interface Props {
  issue: ScanIssue;
  /** 1-based position in the site report's ranking. */
  rank: number;
  onSelect: (nodeId: string) => void;
}

/** One merged issue: how bad, how widespread, the evidence, and every run that hit it. */
export function IssueCard({ issue, rank, onSelect }: Props) {
  const style = SEVERITY_STYLES[issue.severity];

  return (
    <article className="overflow-hidden rounded-card border border-hairline/10 bg-white/4">
      <div className="p-3 pb-0">
        {issue.evidence ? (
          <div className="overflow-hidden rounded-xl">
            <EvidenceImage
              source={{ screenshotKey: issue.evidence.screenshotKey, bbox: issue.evidence.bbox, viewport: issue.evidence.viewport }}
              boxClass={style.box}
              label={issue.evidence.targetLabel}
            />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl bg-graphite px-6 text-center text-caption text-smoke">
            The evidence step was never received.
          </div>
        )}
      </div>

      <div className="px-5 pb-5 pt-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-heading text-subheading tabular-nums leading-none text-ash">{String(rank).padStart(2, "0")}</span>
          <SeverityBadge severity={issue.severity} withLabel />
        </div>
        <h3 className="mt-3 font-heading text-subheading text-white" title={FRICTION_LABELS[issue.category].blurb}>
          {categoryLabel(issue.category)}
        </h3>
        <p className="mt-1 text-caption text-smoke">
          Hit in{" "}
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
        {issue.summary && <p className="mt-3 text-ui leading-snug text-bone">{issue.summary}</p>}
        {issue.whyItMatters && <p className="mt-1.5 text-ui text-ash">{issue.whyItMatters}</p>}
        <p className="mt-3 rounded-ui border border-hairline/15 px-3 py-2 text-ui text-ash">
          <span className="text-bone">Fix: </span>
          {issue.recommendation}
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Tasks that hit this issue">
          {issue.taskIndexes.map((taskIndex) => (
            <button
              key={taskIndex}
              type="button"
              onClick={() => onSelect(scanNodeId({ kind: "task", index: taskIndex }))}
              className="pill-ghost h-7 px-2.5 text-caption tabular-nums"
            >
              T{taskIndex + 1}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
