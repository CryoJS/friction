import { taskVerdict, type ScanReportResponse, type ScanTreeResponse, type ScanTreeTask } from "@friction/shared";
import { VERDICT, rankedIssuesForTask } from "../../lib/scan";
import { Chip } from "../badges";
import { IssueCard } from "./IssueCard";
import { TaskPullRequestCard } from "./TaskPullRequestCard";

interface Props {
  task: ScanTreeTask;
  /** For the task's pull request, and the task a covered one points at. */
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  onSelect: (nodeId: string) => void;
  /** An issue key to force open (and scroll to), e.g. from clicking its satellite on the orbit graph. */
  focusedIssueKey?: string | null;
}

/** One task: what it is, why it matters, its pull request, and the site issues it hit. */
export function TaskPanel({ task, tree, report, onSelect, focusedIssueKey = null }: Props) {
  const verdict = VERDICT[taskVerdict(task.state)];
  const ranked = rankedIssuesForTask(report, task.index);

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-caption tabular-nums tracking-normal text-ash">Task {task.index + 1}</span>
          <Chip tone={verdict.tone}>{verdict.label}</Chip>
          {task.status === "verifying" && <Chip tone="glow">Verifying fixes</Chip>}
        </div>
        <h2 className="mt-2 font-heading text-heading-sm font-medium tracking-[-0.02em] text-white">{task.title}</h2>
      </header>

      <dl className="space-y-3">
        <div>
          <dt className="text-caption text-smoke">Why it's critical</dt>
          <dd className="mt-1 text-body text-ash">{task.whyCritical}</dd>
        </div>
        <div>
          <dt className="text-caption text-smoke">Success looks like</dt>
          <dd className="mt-1 text-body text-ash">{task.successCheck}</dd>
        </div>
      </dl>

      <TaskPullRequestCard task={task} tree={tree} onSelect={onSelect} />

      <section aria-label="Issues in this task">
        <h3 className="font-heading text-subheading text-bone">
          Issues in this task <span className="tabular-nums text-smoke">{ranked.length}</span>
        </h3>
        <div className="mt-3 space-y-2">
          {ranked.length === 0 && <p className="text-caption text-smoke">{report ? "None so far." : "Building the report…"}</p>}
          {ranked.map(({ issue, rank }) => (
            <IssueCard key={issue.key} issue={issue} rank={rank} onSelect={onSelect} forceOpen={issue.key === focusedIssueKey} />
          ))}
        </div>
      </section>
    </div>
  );
}
