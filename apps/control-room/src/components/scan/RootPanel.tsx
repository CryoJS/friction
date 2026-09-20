import {
  SEVERITY_LABELS,
  isScanFinished,
  summarizeTaskPullRequests,
  type CrawledPage,
  type ScanReportResponse,
  type ScanTreeResponse,
  type Severity,
} from "@friction/shared";
import { pathOf } from "../../lib/format";
import { VERDICT, VERDICT_ORDER, hostOf, runProgress } from "../../lib/scan";
import { Dot, SEVERITY_STYLES } from "../badges";
import { Plus } from "../icons";
import { IssueCard } from "./IssueCard";
import { Notice } from "./Notice";

interface Props {
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  onSelect: (nodeId: string) => void;
}

const SEVERITIES: Severity[] = [5, 4, 3, 2, 1];

/** The site node's panel: crawl progress while reading, then the merged site report. */
export function RootPanel({ tree, report, onSelect }: Props) {
  const { scan } = tree;
  const hasTasks = tree.tasks.length > 0;
  const progress = runProgress(tree);
  // While the runs are going, the message is the task-source note, which the notices below already say; after them it is the pull request progress.
  const runsOver = progress.total > 0 && progress.done === progress.total;
  const showMessage = scan.message !== null && (scan.status === "crawling" || scan.status === "completed" || (scan.status === "running" && runsOver));
  const pullRequests = tree.pullRequests ?? [];

  return (
    <div className="space-y-5">
      <header>
        <p className="text-caption text-smoke">Scan results</p>
        <h2 className="mt-1 truncate font-heading text-heading-sm font-medium tracking-[-0.02em] text-white" title={scan.url}>
          {hostOf(scan.url)}
        </h2>
        {showMessage && <p className="mt-1.5 text-ui text-ash">{scan.message}</p>}
      </header>

      {scan.repo && (
        <section aria-label="Pull requests" className="rounded-card border border-hairline/10 bg-white/4 p-5">
          <h3 className="text-caption text-ash">Repository</h3>
          <p className="mt-1 truncate font-mono text-ui tracking-normal text-bone" title={scan.repo}>
            {scan.repo}
          </p>
          <p className="mt-2 text-caption text-smoke">
            {pullRequests.length > 0
              ? summarizeTaskPullRequests(pullRequests).text
              : scan.autoPr
                ? "One draft pull request per fixable task, once every run has finished."
                : "Pull requests are opened by hand, one fix at a time, from a task's results."}
          </p>
        </section>
      )}

      {scan.status === "failed" && <Notice tone="bad">{scan.message ?? "The scan failed."}</Notice>}
      {scan.status === "cancelled" && <Notice tone="warn">{scan.message ?? "The scan was stopped."}</Notice>}
      {scan.taskSource === "fallback" && <Notice tone="warn">Couldn't read the site, so these tasks are generic.</Notice>}
      {scan.taskSource === "mock" && (
        <Notice tone="warn">Mock scan: no API keys, so every run replays the golden run.</Notice>
      )}
      {hasTasks && !isScanFinished(scan.status) && (
        <Notice tone="glow">
          Partial report: {progress.done}/{progress.total} runs done. Issues fill in as the rest do.
        </Notice>
      )}

      {!hasTasks ? (
        <PageList
          pages={scan.pages}
          title={scan.status === "failed" ? "Pages read before the scan failed" : scan.status === "cancelled" ? "Pages read before the scan stopped" : "Pages read so far"}
          reading={scan.status === "crawling"}
        />
      ) : report ? (
        <ReportBody report={report} onSelect={onSelect} />
      ) : (
        <div className="flex flex-col items-center gap-4 py-10 text-body text-smoke" aria-busy="true">
          <div className="wash wash-sweep h-px w-56" aria-hidden="true" />
          Building the report…
        </div>
      )}

      {hasTasks && scan.pages.length > 0 && (
        <details className="group rounded-card border border-hairline/10 bg-white/4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-4 text-ui text-bone transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
            <span>
              Crawled pages <span className="tabular-nums text-smoke">{scan.pages.length}</span>
            </span>
            <Plus size={14} className="shrink-0 text-ash transition-transform duration-300 ease-out group-open:rotate-45" />
          </summary>
          <PageItems pages={scan.pages} className="border-t border-hairline/10" />
        </details>
      )}
    </div>
  );
}

function PageList({ pages, title, reading }: { pages: CrawledPage[]; title: string; reading: boolean }) {
  return (
    <section aria-label={title}>
      <h3 className="text-caption text-ash">
        {title} <span className="tabular-nums text-smoke">{pages.length}</span>
      </h3>
      {pages.length === 0 ? (
        <div className="mt-3 flex flex-col items-center gap-4 rounded-card border border-hairline/10 bg-white/4 px-6 py-10 text-body text-smoke">
          {reading && <div className="wash wash-sweep h-px w-56" aria-hidden="true" />}
          {reading ? "Opening the site…" : "No pages were read."}
        </div>
      ) : (
        <PageItems pages={pages} className="mt-3 rounded-card border border-hairline/10 bg-white/4" />
      )}
      {reading && pages.length > 0 && <div className="wash wash-sweep mt-3 h-px w-full" aria-hidden="true" />}
    </section>
  );
}

function PageItems({ pages, className = "" }: { pages: CrawledPage[]; className?: string }) {
  return (
    <ul className={`divide-y divide-hairline/10 ${className}`}>
      {pages.map((page) => (
        <li key={page.url} className="step-in px-5 py-3">
          <span className="block truncate text-ui text-bone">{page.title || "Untitled page"}</span>
          <span className="mt-0.5 block truncate font-mono text-caption tracking-normal text-smoke" title={page.url}>
            {pathOf(page.url)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReportBody({ report, onSelect }: { report: ScanReportResponse; onSelect: (nodeId: string) => void }) {
  const { summary } = report;
  return (
    <>
      <section aria-label="Summary" className="rounded-card border border-hairline/10 bg-white/4 p-5">
        <h3 className="text-caption text-ash">Tasks</h3>
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {VERDICT_ORDER.map((verdict) => (
            <li key={verdict} className="rounded-ui border border-hairline/10 px-3 py-2.5">
              <span className="block text-heading-sm tabular-nums leading-none text-white">{summary.verdicts[verdict]}</span>
              <span className="mt-2 flex items-center gap-1.5 text-caption text-smoke">
                <Dot tone={VERDICT[verdict].tone} size={6} />
                {VERDICT[verdict].label}
              </span>
            </li>
          ))}
        </ul>

        <h3 className="mt-5 text-caption text-ash">Issues by severity</h3>
        <ul className="mt-2 grid grid-cols-5 gap-1.5">
          {SEVERITIES.map((severity) => {
            const count = summary.issuesBySeverity[severity];
            return (
              <li key={severity} className="min-w-0" title={`Severity ${severity} of 5`}>
                <span aria-hidden="true" className={`block h-2 rounded-full ${count > 0 ? SEVERITY_STYLES[severity].dot : "bg-hairline/10"}`} />
                <span className="mt-2 block text-subheading tabular-nums leading-none text-white">{count}</span>
                <span className={`mt-1 block truncate text-caption ${count > 0 ? SEVERITY_STYLES[severity].text : "text-smoke"}`}>
                  {SEVERITY_LABELS[severity]}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Issues">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-heading text-subheading text-bone">
            Issues <span className="tabular-nums text-smoke">{report.issues.length}</span>
          </h3>
          <p className="text-caption text-smoke">By severity, then reach</p>
        </div>
        <div className="mt-3 space-y-2">
          {report.issues.length === 0 && (
            <p className="rounded-card border border-dashed border-hairline/20 px-6 py-10 text-center text-body text-smoke">No friction found yet.</p>
          )}
          {report.issues.map((issue, index) => (
            <IssueCard key={issue.key} issue={issue} rank={index + 1} onSelect={onSelect} />
          ))}
        </div>
      </section>
    </>
  );
}
