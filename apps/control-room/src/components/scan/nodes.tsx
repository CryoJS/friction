/**
 * The two node kinds on the scan canvas: the site and its tasks. Each node is one <button>, so Tab
 * reaches it and Enter selects it; React Flow's own selection, dragging and
 * connecting are off (see ScanGraph).
 *
 * React Flow sets pointer-events: none on nodes that are neither draggable
 * nor selectable, and the property inherits, so every button opts back in
 * with pointer-events-auto.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { AgentState } from "@friction/shared";
import { MAX_STEPS } from "../../lib/config";
import { SCAN_STATE_LABELS, SCAN_STATUS, VERDICT, VERDICT_ORDER } from "../../lib/scan";
import type { RootFlowNode, TaskFlowNode } from "../../lib/scanLayout";
import { Chip, Dot, SEVERITY_STYLES } from "../badges";
import { Check, Cross } from "../icons";

/** Shared by every node: opaque graphite, text lifts to white on hover, and a subtle brighter fill when selected. */
function frame(): string {
  return "group pointer-events-auto text-left transition-colors duration-150 ease-out";
}

function nodeStyle(selected: boolean): { backgroundColor: string } {
  return { backgroundColor: selected ? "rgb(255 255 255 / 0.08)" : "var(--color-graphite)" };
}

/** Neutral nodes: the same hairline stays in place while selection is shown by the fill. */
function neutralBorder(selected: boolean): string {
  return selected ? "border-hairline/15" : "border-hairline/15 hover:border-hairline/40";
}

export function RootNode({ id, data }: NodeProps<RootFlowNode>) {
  const status = SCAN_STATUS[data.status];
  return (
    <>
      <button
        type="button"
        onClick={() => data.onSelect(id)}
        aria-current={data.selected ? "true" : undefined}
        style={nodeStyle(data.selected)}
        className={`${frame()} ${neutralBorder(data.selected)} flex w-65 flex-col rounded-card border p-4`}
      >
        <span className="flex items-center justify-between gap-2">
          <Chip tone={status.tone}>{status.label}</Chip>
          <span className="text-caption text-smoke">Site</span>
        </span>
        <span className="mt-3 truncate font-heading text-subheading text-bone group-hover:text-white">{data.host}</span>

        {data.status === "crawling" && (
          <>
            <span className="mt-1 line-clamp-2 text-caption text-ash">{data.message ?? "Opening the site"}</span>
            <span className="mt-1 text-caption tabular-nums text-smoke">
              {data.pagesRead} {data.pagesRead === 1 ? "page" : "pages"} read
            </span>
          </>
        )}

        {data.tasks > 0 && (
          <>
            <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption tabular-nums text-ash">
              {VERDICT_ORDER.filter((verdict) => verdict !== "pending" || data.verdicts.pending > 0).map((verdict) => (
                <span key={verdict} className="inline-flex items-center gap-1.5">
                  <Dot tone={VERDICT[verdict].tone} size={6} />
                  <span className="text-bone">{data.verdicts[verdict]}</span> {VERDICT[verdict].label.toLowerCase()}
                </span>
              ))}
            </span>
            <span className="mt-1 text-caption tabular-nums text-smoke">
              {data.issues === null ? "Counting issues" : `${data.issues} ${data.issues === 1 ? "issue" : "issues"}`} · {data.runsDone}/{data.runsTotal}{" "}
              runs done
            </span>
          </>
        )}

        {/* Once every run is over, a running scan's message is its pull request progress. */}
        {data.status === "running" && data.runsTotal > 0 && data.runsDone === data.runsTotal && data.message && (
          <span className="mt-1 line-clamp-2 text-caption text-ash">{data.message}</span>
        )}
        {data.status === "failed" && <span className="mt-2 line-clamp-3 text-caption text-sev-5">{data.message ?? "The scan failed."}</span>}
        {data.taskSource === "fallback" && <span className="mt-2 text-caption text-sev-4">Couldn't read the site; these tasks are generic.</span>}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

/** ✓ / ✗ / … for a task's run, in the system's lights. */
function Mark({ state }: { state: AgentState }) {
  switch (state) {
    case "succeeded":
      return <Check size={14} className="text-white" />;
    case "failed":
      return <Cross size={14} className="text-sev-5" />;
    case "timeout":
      return <Cross size={14} className="text-sev-4" />;
    case "running":
      return <Dot tone="glow" size={8} />;
    default:
      return <Dot tone="idle" size={6} />;
  }
}

export function TaskNode({ id, data }: NodeProps<TaskFlowNode>) {
  const border = data.worst !== null ? SEVERITY_STYLES[data.worst].box : neutralBorder(data.selected);
  const stateLabel = data.status === "verifying" ? "Verifying fixes" : SCAN_STATE_LABELS[data.state];
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        onClick={() => data.onSelect(id)}
        aria-current={data.selected ? "true" : undefined}
        title={data.title}
        style={nodeStyle(data.selected)}
        className={`${frame()} ${border} flex h-28 w-80 flex-col rounded-2xl border p-3`}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-caption tabular-nums tracking-normal text-ash">Task {data.index + 1}</span>
          <span className="ml-auto flex items-center gap-1.5 text-caption text-smoke">
            {stateLabel}
            <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
              {data.status === "verifying" ? <Dot tone="glow" size={8} /> : <Mark state={data.state} />}
            </span>
          </span>
        </span>
        <span className="mt-1.5 line-clamp-2 text-ui leading-snug text-bone group-hover:text-white">{data.title}</span>
        <span className="mt-auto flex items-center gap-3 text-caption tabular-nums text-smoke">
          <span title={`${data.stepCount} of ${MAX_STEPS} steps`}>
            {data.stepCount}/{MAX_STEPS} steps
          </span>
          <span>
            <span className={data.findingCount > 0 ? "text-bone" : undefined}>{data.findingCount}</span>{" "}
            {data.findingCount === 1 ? "finding" : "findings"}
          </span>
          {data.pullRequest && (
            <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-ash" title={data.pullRequest.title}>
              <Dot tone={data.pullRequest.tone} size={6} />
              <span className="truncate">{data.pullRequest.label}</span>
            </span>
          )}
        </span>
      </button>
    </>
  );
}
