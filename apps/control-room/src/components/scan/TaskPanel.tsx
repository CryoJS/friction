import { taskVerdict, type ScanReportResponse, type ScanTreeTask } from "@friction/shared";
import { useRunStream } from "../../hooks/useRunStream";
import { VERDICT } from "../../lib/scan";
import { LanePane } from "../LanePane";
import { Chip } from "../badges";
import { ArrowRight } from "../icons";
import { IssueCard } from "./IssueCard";
import { Notice } from "./Notice";

interface Props {
  task: ScanTreeTask;
  report: ScanReportResponse | null;
  onSelect: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

/**
 * One task: what it is, why it matters, its run live (the control room's own
 * LanePane on the run's SSE stream), and the site issues it hit. SidePanel
 * keys it by run id, so selecting another task opens that run's stream.
 */
export function TaskPanel({ task, report, onSelect, onOpenRun }: Props) {
  const stream = useRunStream(task.runId, { replay: false });
  const verdict = VERDICT[taskVerdict(task.state)];
  const fixes = Object.keys(stream.view.fixes).length;
  const ranked = report
    ? report.issues.map((issue, index) => ({ issue, rank: index + 1 })).filter(({ issue }) => issue.taskIndexes.includes(task.index))
    : [];

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-caption tabular-nums tracking-normal text-ash">T{task.index + 1}</span>
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

      <section aria-label="The run">
        {stream.notice && <Notice tone="warn">{stream.notice}</Notice>}
        {/* From lg the panel scrolls on its own, so the pane gets a fixed height and scrolls its findings and timeline inside it. */}
        <div className="mt-3 grid lg:h-160">
          <LanePane
            lane={stream.view.primary}
            title="The agent"
            allowLiveView={stream.origin === "live"}
            startTs={stream.view.firstTs}
            layout="stacked"
            idleLabel="Queued"
          />
        </div>
        {/* A real link, so it opens in a new tab too; a plain click stays in the app. */}
        <a
          href={`?run=${encodeURIComponent(task.runId)}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            onOpenRun(task.runId);
          }}
          className="pill-ghost mt-3"
        >
          {fixes > 0 ? `Open full control room · ${fixes} ${fixes === 1 ? "fix" : "fixes"}` : "Open full control room"}
          <ArrowRight size={14} />
        </a>
      </section>

      <section aria-label="Issues in this task">
        <h3 className="font-heading text-subheading text-bone">
          Issues in this task <span className="tabular-nums text-smoke">{ranked.length}</span>
        </h3>
        <div className="mt-3 space-y-4">
          {ranked.length === 0 && <p className="text-caption text-smoke">{report ? "None so far." : "Building the report…"}</p>}
          {ranked.map(({ issue, rank }) => (
            <IssueCard key={issue.key} issue={issue} rank={rank} onSelect={onSelect} />
          ))}
        </div>
      </section>
    </div>
  );
}
