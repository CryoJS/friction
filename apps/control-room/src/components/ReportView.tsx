import { FRICTION_LABELS, SEVERITY_LABELS, type FixEvent, type ReportFinding, type ReportResponse, type Severity, type StepPayload } from "@friction/shared";
import { fixList, type RunView } from "../lib/runState";
import { FixComparison, type PullRequestAvailability } from "./FixComparison";
import { ACTION_VERBS, formatDuration, percent } from "../lib/format";
import { EvidenceImage } from "./EvidenceImage";
import { SEVERITY_STYLES, SeverityBadge, StageBadge, StateBadge, categoryLabel } from "./badges";
import { ArrowUpRight } from "./icons";

interface Props {
  report: ReportResponse | null;
  loading: boolean;
  /** Assembled in the browser because the Worker did not answer. */
  local: boolean;
  /** Full step payloads the control room already holds, so wireframe evidence renders offline. */
  findStep: (seq: number) => StepPayload | undefined;
  /** The run as the room sees it: the lanes and fixes the comparisons are drawn from. */
  view: RunView;
  allowLiveView: boolean;
  pullRequests: PullRequestAvailability;
  onOpenPullRequest: (findingId: string) => Promise<string>;
}

const SEVERITIES: Severity[] = [5, 4, 3, 2, 1];

export function ReportView({ report, loading, local, findStep, view, allowLiveView, pullRequests, onOpenPullRequest }: Props) {
  const fixes = fixList(view);
  const fixByFinding = new Map(fixes.map((fix) => [fix.payload.findingId, fix] as const));
  if (!report) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 text-body text-smoke" aria-busy={loading}>
        {loading && <div className="wash wash-sweep h-px w-56" aria-hidden="true" />}
        {loading ? "Building the report…" : "No report available for this run."}
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-300 px-4 pb-20 pt-5 sm:px-6">
        {fixes.length > 0 && (
          <section className="mb-14" aria-labelledby="fixes-heading">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="fixes-heading" className="font-heading text-[32px] font-semibold leading-tight tracking-tight text-bone">
                  Fixes, tested
                </h2>
                <p className="mt-1 max-w-[70ch] text-caption text-smoke">
                  The top findings got a proposed fix. Each was tested by re-running the same task in a fresh browser with the fix installed, and compared with the
                  original run.
                </p>
              </div>
            </div>
            <div className="space-y-6">
              {fixes.map((fix) => {
                const finding = report.findings.find((f) => f.id === fix.payload.findingId) ?? null;
                return (
                  <FixComparison
                    key={fix.payload.findingId}
                    fix={fix}
                    finding={finding ? { severity: finding.severity, summary: finding.summary, hitCount: finding.hitCount } : null}
                    before={view.primary}
                    after={view.verify[fix.payload.findingId]}
                    allowLiveView={allowLiveView}
                    startTs={view.firstTs}
                    pullRequests={pullRequests}
                    onOpenPullRequest={onOpenPullRequest}
                  />
                );
              })}
            </div>
          </section>
        )}

        <section className="relative isolate overflow-hidden rounded-large border border-hairline/10 bg-white/4 p-6 sm:p-8" aria-label="Summary">
          <div aria-hidden="true" className="spotlight pointer-events-none absolute -left-40 -top-48 -z-10 h-[480px] w-[480px]" />

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="flex items-end gap-5">
              <span className="text-display tabular-nums text-white">{report.totals.findings}</span>
              <span className="pb-2 text-subheading text-ash">
                friction {report.totals.findings === 1 ? "finding" : "findings"}
                <br />
                in one run of the task
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-ui lg:justify-end" aria-label="How the run went">
              <span className="tabular-nums text-smoke">
                {report.primary.stepCount} steps{report.primary.durationMs !== null && ` · ${formatDuration(report.primary.durationMs)}`}
              </span>
              <StateBadge state={report.primary.state} />
            </div>
          </div>

          <SeveritySpectrum counts={report.totals.bySeverity} total={report.totals.findings} />

          {(local || report.source === "fixture") && (
            <p className="mt-6 border-t border-hairline/10 pt-4 text-caption text-smoke">
              {local && "The Worker did not answer, so this report was assembled in the browser from the events on screen. "}
              {report.source === "fixture" && "Data source: the golden fixture, not a live site."}
            </p>
          )}
        </section>

        <div className="mt-14 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-heading text-[32px] font-semibold leading-tight tracking-tight text-bone">Findings</h2>
            <p className="mt-1 text-caption text-smoke">Ranked by severity, then confidence.</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {report.findings.length === 0 && (
            <p className="rounded-card border border-dashed border-hairline/20 px-6 py-12 text-center text-body text-smoke">No friction found yet.</p>
          )}
          {report.findings.map((finding, index) => (
            <FindingCard key={finding.id} rank={index + 1} finding={finding} payload={findStep(finding.evidenceSeq)} fix={fixByFinding.get(finding.id) ?? null} />
          ))}
        </div>
      </div>
    </main>
  );
}

/** Findings laid out hot to cool, like the horizon they are sampled from. Each segment labels itself. */
function SeveritySpectrum({ counts, total }: { counts: Record<Severity, number>; total: number }) {
  const present = SEVERITIES.filter((severity) => counts[severity] > 0);
  if (total === 0) {
    return (
      <div className="mt-8">
        <div className="h-2 rounded-full bg-hairline/10" />
        <p className="mt-3 text-caption text-smoke">No friction at any severity.</p>
      </div>
    );
  }
  return (
    <ul className="mt-8 flex gap-1" aria-label="Findings by severity">
      {present.map((severity) => (
        <li key={severity} className="min-w-[104px]" style={{ flexGrow: counts[severity], flexBasis: 0 }} title={`Severity ${severity} of 5`}>
          <span aria-hidden="true" className={`block h-2 rounded-full ${SEVERITY_STYLES[severity].dot}`} />
          <span className="mt-3 flex items-baseline gap-2 whitespace-nowrap">
            <span className="text-heading-sm tabular-nums text-white">{counts[severity]}</span>
            <span className={`text-ui ${SEVERITY_STYLES[severity].text}`}>{SEVERITY_LABELS[severity]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function FindingCard({ finding, rank, payload, fix }: { finding: ReportFinding; rank: number; payload: StepPayload | undefined; fix: FixEvent | null }) {
  const style = SEVERITY_STYLES[finding.severity];
  const evidence = finding.evidence;

  return (
    <article className="overflow-hidden rounded-card border border-hairline/10 bg-white/4">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
        <div className="p-3 pb-0 lg:pb-3">
          {evidence ? (
            <div className="overflow-hidden rounded-[14px]">
              <EvidenceImage
                source={{ screenshotKey: evidence.screenshotKey, bbox: evidence.bbox, viewport: evidence.viewport, payload }}
                boxClass={style.box}
                label={evidence.targetLabel}
              />
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-[14px] bg-graphite px-6 text-center text-caption text-smoke">
              The evidence step was never received.
            </div>
          )}
        </div>

        <div className="min-w-0 p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="mr-1 font-heading text-heading-sm tabular-nums leading-none text-ash">{String(rank).padStart(2, "0")}</span>
            <SeverityBadge severity={finding.severity} withLabel />
            {fix && (
              <a href="#fixes-heading" className="rounded-full" title="See the fix and its verification above">
                <StageBadge stage={fix.payload.stage} />
              </a>
            )}
            {finding.hitCount > 1 && (
              <span className="tag" title="Times the agent ran into this in one run">
                Hit {finding.hitCount}×
              </span>
            )}
            <Confidence value={finding.confidence} />
          </div>

          <h3 className="mt-4 font-heading text-heading-sm font-medium tracking-[-0.02em] text-white" title={FRICTION_LABELS[finding.category].blurb}>
            {categoryLabel(finding.category)}
          </h3>
          {finding.summary && <p className="mt-2 max-w-[65ch] text-subheading leading-snug text-bone">{finding.summary}</p>}
          {finding.whyItMatters && <p className="mt-2 max-w-[65ch] text-body text-ash">{finding.whyItMatters}</p>}

          <div className="mt-5 rounded-ui border border-hairline/15 px-4 py-3">
            <div className="text-caption text-smoke">Recommendation</div>
            <p className="mt-1 max-w-[65ch] text-body text-bone">{finding.recommendation}</p>
          </div>

          {evidence && (
            <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-ui">
              <dt className="text-smoke">URL</dt>
              <dd className="truncate font-mono text-[13px] tracking-normal text-bone" title={evidence.url}>
                {evidence.url}
              </dd>
              <dt className="text-smoke">Selector</dt>
              <dd className="truncate font-mono text-[13px] tracking-normal text-bone" title={evidence.selector}>
                {evidence.selector || "n/a"}
              </dd>
              <dt className="text-smoke">Action</dt>
              <dd className="text-bone">
                {ACTION_VERBS[evidence.actionType]} {evidence.targetLabel && `“${evidence.targetLabel}”`}
                {evidence.value && evidence.actionType !== "navigate" && <span className="text-ash"> ({evidence.value})</span>}
                <span className="tabular-nums text-smoke"> · {formatDuration(evidence.durationMs)} · event #{evidence.seq}</span>
              </dd>
              <dt className="text-smoke">Thinking</dt>
              <dd className="italic text-ash">“{evidence.rationale}”</dd>
            </dl>
          )}

          <div className="mt-6">
            {finding.replayUrl ? (
              <a href={finding.replayUrl} target="_blank" rel="noreferrer" className="pill-ghost">
                Watch the Browserbase session replay
                <ArrowUpRight size={14} />
              </a>
            ) : (
              <span className="text-caption text-smoke">No Browserbase session replay for this run (fixture or mock data).</span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Confidence({ value }: { value: number }) {
  return (
    <span className="ml-auto flex items-center gap-2 text-caption text-smoke" title="How sure the judgement is that this is real friction">
      <span className="h-0.5 w-16 overflow-hidden rounded-full bg-hairline/15">
        <span className="block h-full rounded-full bg-bone" style={{ width: percent(value) }} />
      </span>
      <span className="tabular-nums">{percent(value)} confident</span>
    </span>
  );
}
