import { useState } from "react";
import { isTerminalState, type FixEvent, type LaneResult, type Severity } from "@friction/shared";
import { formatDuration } from "../lib/format";
import type { LaneView } from "../lib/runState";
import { SeverityBadge, StageBadge, categoryLabel } from "./badges";
import { ArrowUpRight } from "./icons";
import { LanePane } from "./LanePane";

export interface FindingHeadline {
  severity: Severity;
  summary: string | null;
  hitCount: number;
}

/** Whether this screen can open a pull request at all, and if not, why. */
export interface PullRequestAvailability {
  enabled: boolean;
  reason: string | null;
}

interface Props {
  fix: FixEvent;
  finding: FindingHeadline | null;
  /** The primary run. */
  before: LaneView;
  /** The verify run with the fix installed; absent until it starts. */
  after: LaneView | undefined;
  allowLiveView: boolean;
  startTs: number | null;
  pullRequests: PullRequestAvailability;
  onOpenPullRequest: (findingId: string) => Promise<string>;
}

const HEADLINES: Record<FixEvent["payload"]["stage"], string> = {
  proposed: "A fix is proposed",
  verifying: "Re-running the task with the fix applied",
  verified: "Verified: the fix removed the friction",
  rejected: "The fix did not resolve it",
  pr_opened: "Verified, and a draft pull request is open",
};

const OUTCOME_WORDS: Record<LaneResult["outcome"], string> = { success: "completed", failure: "gave up", timeout: "timed out" };

function resultLine(result: LaneResult | null, lane: LaneView | undefined, lanePrefix: string): string {
  if (result) return `lane ${lanePrefix} · ${result.steps} steps · ${OUTCOME_WORDS[result.outcome]} · ${formatDuration(result.durationMs)}`;
  if (!lane) return `lane ${lanePrefix}`;
  return `lane ${lanePrefix} · ${lane.steps.length} steps${isTerminalState(lane.state) ? "" : " so far"}`;
}

/**
 * The payoff screen: the same task, before and after a fix, side by side. The
 * same pane renders both lanes, so the difference is the only difference.
 */
export function FixComparison({ fix, finding, before, after, allowLiveView, startTs, pullRequests, onOpenPullRequest }: Props) {
  const p = fix.payload;
  const decided = p.stage === "verified" || p.stage === "rejected" || p.stage === "pr_opened";
  const rejected = p.stage === "rejected";
  const showPanes = p.stage !== "proposed";

  return (
    <article
      className={`overflow-hidden rounded-large border p-4 sm:p-6 ${rejected ? "border-sev-3/45 bg-sev-3/[0.04]" : "border-hairline/12 bg-white/[0.035]"}`}
      aria-label={`Fix for ${categoryLabel(p.category ?? "dead_click")}: ${HEADLINES[p.stage]}`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <StageBadge stage={p.stage} />
        {finding && <SeverityBadge severity={finding.severity} />}
        {p.category && <span className="text-ui text-bone">{categoryLabel(p.category)}</span>}
        {finding && finding.hitCount > 1 && <span className="tag">Hit {finding.hitCount}×</span>}
        {finding?.summary && <span className="min-w-0 flex-1 basis-60 truncate text-caption text-smoke" title={finding.summary}>{finding.summary}</span>}
      </div>

      <div className="mt-4 grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <h3 className={`font-heading text-heading-sm font-medium tracking-[-0.02em] ${rejected ? "text-sev-3" : "text-white"}`}>{HEADLINES[p.stage]}</h3>
          {p.note && decided && <p className="mt-1.5 max-w-[70ch] text-subheading leading-snug text-bone">{p.note}</p>}
          <p className="mt-2 max-w-[75ch] text-body text-ash">
            <span className="text-bone">The fix: </span>
            {p.summary}
          </p>
        </div>
        {p.before && p.after && <Contrast before={p.before} after={p.after} rejected={rejected} />}
      </div>

      {showPanes && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LanePane lane={before} title="Before" subtitle={resultLine(p.before, before, "primary")} allowLiveView={false} startTs={startTs} layout="stacked" />
          {after ? (
            <LanePane
              lane={after}
              title={p.stage === "verifying" ? "After · re-running with the fix applied" : "After"}
              subtitle={resultLine(p.after, after, "verify")}
              accent={rejected ? "warn" : decided ? "good" : "none"}
              allowLiveView={allowLiveView}
              startTs={startTs}
              layout="stacked"
            />
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-hairline/20 px-6 text-center">
              <p className="text-body text-bone">Opening a fresh browser session with the fix installed</p>
              <div className="wash wash-sweep h-px w-40" aria-hidden="true" />
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-t border-hairline/10 pt-4">
        <div className="min-w-0 flex-1 basis-[360px]">
          <details className="group">
            <summary className="cursor-pointer list-none text-ui text-bone transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
              <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
              The patch that was tested
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto rounded-ui border border-hairline/10 bg-void/70 p-3 font-mono text-[12.5px] leading-relaxed tracking-normal text-bone">
              <code>{p.patchJs}</code>
            </pre>
          </details>
          <p className="mt-2 max-w-[72ch] text-caption text-smoke">
            Installed with <code className="font-mono tracking-normal">addInitScript</code> before the first page load, only inside Friction's own disposable browser
            session. Your site, server and repository were not changed.
          </p>
        </div>
        <PullRequestAction fix={fix} availability={pullRequests} onOpen={onOpenPullRequest} />
      </div>
    </article>
  );
}

/** "14 steps · gave up  →  11 steps · completed": the claim in two numbers. */
function Contrast({ before, after, rejected }: { before: LaneResult; after: LaneResult; rejected: boolean }) {
  return (
    <div className="flex items-center gap-3 text-right" aria-label="Before and after">
      <Figure label="Before" result={before} muted />
      <span aria-hidden="true" className="text-heading-sm text-smoke">
        →
      </span>
      <Figure label="After" result={after} tone={rejected ? "text-sev-3" : after.outcome === "success" ? "text-white" : "text-bone"} />
    </div>
  );
}

function Figure({ label, result, muted = false, tone = "text-bone" }: { label: string; result: LaneResult; muted?: boolean; tone?: string }) {
  return (
    <div className="min-w-[96px]">
      <div className="text-caption text-smoke">{label}</div>
      <div className={`font-mono text-[28px] leading-none tabular-nums tracking-[-0.02em] ${muted ? "text-ash" : tone}`}>{result.steps}</div>
      <div className={`mt-1 text-caption ${muted ? "text-smoke" : tone}`}>
        steps · {OUTCOME_WORDS[result.outcome]}
      </div>
    </div>
  );
}

function PullRequestAction({ fix, availability, onOpen }: { fix: FixEvent; availability: PullRequestAvailability; onOpen: (findingId: string) => Promise<string> }) {
  const p = fix.payload;
  const [state, setState] = useState<{ status: "idle" | "opening" | "error"; message: string | null; url: string | null }>({ status: "idle", message: null, url: null });
  const prUrl = p.prUrl ?? state.url;

  if (prUrl) {
    return (
      <a href={prUrl} target="_blank" rel="noreferrer" className="pill-cta shrink-0">
        View the draft pull request
        <ArrowUpRight size={14} />
      </a>
    );
  }
  if (p.stage === "rejected") return <p className="max-w-[34ch] text-caption text-smoke">A fix that did not resolve the problem never becomes a pull request.</p>;
  if (p.stage !== "verified") return <p className="max-w-[34ch] text-caption text-smoke">A pull request can be opened once the fix is verified.</p>;
  if (!p.sourceFile) {
    return <p className="max-w-[40ch] text-caption text-smoke">Verified, but not mapped to a source file in a connected repository, so there is no pull request to open.</p>;
  }

  const open = async (): Promise<void> => {
    setState({ status: "opening", message: null, url: null });
    try {
      const url = await onOpen(p.findingId);
      setState({ status: "idle", message: null, url });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err), url: null });
    }
  };

  return (
    <div className="flex max-w-[44ch] flex-col items-start gap-2 sm:items-end sm:text-right">
      <button type="button" className="pill-cta" onClick={() => void open()} disabled={!availability.enabled || state.status === "opening"}>
        {state.status === "opening" ? "Opening a draft…" : "Open pull request"}
      </button>
      <p className="text-caption text-smoke">
        A draft PR changing <code className="font-mono tracking-normal text-bone">{p.sourceFile}</code>. You review it; nothing is merged.
      </p>
      {!availability.enabled && availability.reason && <p className="text-caption text-smoke">{availability.reason}</p>}
      {state.status === "error" && state.message && (
        <p role="alert" className="text-caption text-sev-4">
          {state.message}
        </p>
      )}
    </div>
  );
}
