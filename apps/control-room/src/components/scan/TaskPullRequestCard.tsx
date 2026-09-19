import { scanNodeId, type ScanTreeResponse, type ScanTreeTask, type TaskPullRequest } from "@friction/shared";
import { TASK_PR, coveredByLabel } from "../../lib/scan";
import { Chip } from "../badges";
import { ArrowRight, ArrowUpRight, Plus } from "../icons";
import { Notice } from "./Notice";

interface Props {
  task: ScanTreeTask;
  tree: ScanTreeResponse;
  onSelect: (nodeId: string) => void;
}

/**
 * What became of this task's pull request. Everything shown is already
 * recorded in the Worker, so it renders the same with the orchestrator down.
 */
export function TaskPullRequestCard({ task, tree, onSelect }: Props) {
  const { scan } = tree;
  const pr = tree.pullRequests?.find((candidate) => candidate.runId === task.runId);
  if (!pr && !(scan.repo && scan.autoPr)) return null;

  return (
    <section aria-label="Pull request" className="rounded-card border border-hairline/10 bg-white/4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-subheading text-bone">Pull request</h3>
        {pr && <Chip tone={TASK_PR[pr.status].tone}>{pr.status === "covered" ? coveredByLabel(pr.coveredBy) : TASK_PR[pr.status].label}</Chip>}
      </div>
      {scan.repo && <p className="mt-1 font-mono text-caption tracking-normal text-smoke">{scan.repo}</p>}
      <div className="mt-3 space-y-3">{pr ? <Outcome pr={pr} tree={tree} onSelect={onSelect} /> : <Waiting tree={tree} />}</div>
    </section>
  );
}

function Waiting({ tree }: { tree: ScanTreeResponse }) {
  const finished = tree.scan.status === "completed" || tree.scan.status === "failed";
  return (
    <p className="text-caption text-smoke">
      {finished ? "No pull request outcome was recorded for this task." : "Draft pull requests open once every run has finished, one task at a time, in task order."}
    </p>
  );
}

function Outcome({ pr, tree, onSelect }: { pr: TaskPullRequest; tree: ScanTreeResponse; onSelect: (nodeId: string) => void }) {
  switch (pr.status) {
    case "opened":
      return (
        <>
          <p className="text-ui text-ash">
            A draft pull request fixes {pr.findingIds.length === 1 ? "this task's verified problem" : `${pr.findingIds.length} verified problems of this task`}. Friction never
            merges it.
          </p>
          {pr.prUrl && (
            <a href={pr.prUrl} target="_blank" rel="noreferrer" className="pill-cta">
              View the draft pull request
              <ArrowUpRight size={14} />
            </a>
          )}
          {pr.branch && <p className="font-mono text-caption tracking-normal text-smoke">{pr.branch}</p>}
          <NotFixed pr={pr} />
        </>
      );
    case "dry_run":
      return (
        <>
          <p className="text-ui text-ash">Preview only, nothing was pushed. This is the draft pull request Friction would open.</p>
          <Preview pr={pr} />
          <NotFixed pr={pr} />
        </>
      );
    case "covered":
      return (
        <>
          <p className="text-ui text-ash">Every fix of this task changes a file another pull request already rewrites, so it opens none of its own.</p>
          <CoveredBy pr={pr} tree={tree} onSelect={onSelect} />
          <NotFixed pr={pr} />
        </>
      );
    case "nothing_to_fix":
      return (
        <>
          <p className="text-ui text-ash">No problem in this task had a fix that was both verified and mapped to a source file.</p>
          <NotFixed pr={pr} />
        </>
      );
    case "skipped":
    case "failed":
      return (
        <>
          <Notice tone={pr.status === "failed" ? "bad" : "warn"}>{pr.reason ?? (pr.status === "failed" ? "The pull request could not be opened." : "Nothing could be committed.")}</Notice>
          {pr.branch && <p className="font-mono text-caption tracking-normal text-smoke">{pr.branch}</p>}
          <NotFixed pr={pr} />
        </>
      );
  }
}

function CoveredBy({ pr, tree, onSelect }: { pr: TaskPullRequest; tree: ScanTreeResponse; onSelect: (nodeId: string) => void }) {
  const by = pr.coveredBy;
  if (by === undefined) return null;
  if (typeof by === "string") {
    return (
      <a href={by} target="_blank" rel="noreferrer" className="pill-ghost">
        View the open pull request
        <ArrowUpRight size={14} />
      </a>
    );
  }
  const owner = tree.pullRequests?.find((candidate) => candidate.taskIndex === by);
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => onSelect(scanNodeId({ kind: "task", index: by }))} className="pill-ghost">
        Go to task {by + 1}
        <ArrowRight size={14} />
      </button>
      {owner?.prUrl && (
        <a href={owner.prUrl} target="_blank" rel="noreferrer" className="pill-ghost">
          View its draft pull request
          <ArrowUpRight size={14} />
        </a>
      )}
    </div>
  );
}

function Preview({ pr }: { pr: TaskPullRequest }) {
  const preview = pr.preview;
  if (!preview) return null;
  return (
    <details className="group rounded-ui border border-hairline/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-ui px-4 py-3 text-ui text-bone transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
        <span>Preview pull request</span>
        <Plus size={14} className="shrink-0 text-ash transition-transform duration-300 ease-out group-open:rotate-45" />
      </summary>
      <div className="space-y-3 border-t border-hairline/10 px-4 py-4">
        <p className="text-ui text-white">{preview.title}</p>
        {pr.branch && <p className="font-mono text-caption tracking-normal text-smoke">{pr.branch}</p>}
        <ul className="space-y-1">
          {preview.files.map((file) => (
            <li key={file.path} className="flex items-baseline justify-between gap-3 font-mono text-caption tracking-normal">
              <span className="min-w-0 truncate text-bone" title={file.path}>
                {file.path}
              </span>
              <span className="shrink-0 tabular-nums text-ash">
                +{file.addedLines} −{file.removedLines}
              </span>
            </li>
          ))}
        </ul>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-ui border border-hairline/10 bg-void/40 p-3 font-mono text-caption tracking-normal text-ash">
          {preview.body}
        </pre>
      </div>
    </details>
  );
}

function NotFixed({ pr }: { pr: TaskPullRequest }) {
  if (pr.notFixed.length === 0) return null;
  return (
    <div>
      <h4 className="text-caption text-smoke">Found, not fixed</h4>
      <ul className="mt-1.5 space-y-1.5">
        {pr.notFixed.map((item) => (
          <li key={item.findingId} className="text-caption text-ash">
            <span className="font-mono tracking-normal text-smoke">{item.findingId}</span> {item.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
