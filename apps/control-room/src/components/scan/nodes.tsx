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
import { SEVERITY_LABELS, taskVerdict, type AgentState } from "@friction/shared";
import { pathOf } from "../../lib/format";
import { MAX_STEPS } from "../../lib/config";
import { SCAN_STATE_LABELS, SCAN_STATUS, VERDICT, VERDICT_ORDER } from "../../lib/scan";
import type { IssueFlowNode, RingFlowNode, RootFlowNode, TaskFlowNode } from "../../lib/scanLayout";
import { Chip, Dot, SEVERITY_STYLES, SeverityIcon, categoryLabel } from "../badges";
import { Check, Cross } from "../icons";
import { HoverCard } from "./HoverCard";

/**
 * One handle per compass side, so an edge can leave from (or arrive at)
 * whichever side actually faces the other node -- see sideOf in scanLayout.ts.
 * All four sit at the node's centre on both axes (React Flow only offsets
 * them along the side they're pinned to), so the edge reads as a spoke from
 * the node's middle, not from a corner.
 */
function CompassHandles({ type }: { type: "source" | "target" }) {
  const centered = { top: "50%", left: "50%" };
  return (
    <>
      <Handle type={type} id="top" position={Position.Top} isConnectable={false} style={centered} />
      <Handle type={type} id="right" position={Position.Right} isConnectable={false} style={centered} />
      <Handle type={type} id="bottom" position={Position.Bottom} isConnectable={false} style={centered} />
      <Handle type={type} id="left" position={Position.Left} isConnectable={false} style={centered} />
    </>
  );
}

/** A dashed orbit oval, purely decorative: no pointer events, sits behind every real node. rounded-full on a non-square box still renders a true ellipse. */
export function OrbitRing({ data }: NodeProps<RingFlowNode>) {
  return <div style={{ width: data.radiusX * 2, height: data.radiusY * 2 }} className="pointer-events-none rounded-full border border-dashed border-hairline/10" />;
}

/** Shared by every node: opaque graphite, text lifts to white on hover, and a solid (never see-through) lighter fill when selected. */
function frame(): string {
  return "group pointer-events-auto text-left transition-colors duration-150 ease-out";
}

/** Both states are fully opaque solid colours -- a node must never let the canvas, an edge or another node show through it. */
function nodeStyle(selected: boolean): { backgroundColor: string } {
  return { backgroundColor: selected ? "#262626" : "var(--color-graphite)" };
}

/** Neutral nodes: the same hairline stays in place while selection is shown by the fill. */
function neutralBorder(selected: boolean): string {
  return selected ? "border-hairline/15" : "border-hairline/15 hover:border-hairline/40";
}

/** The root panel's key facts, condensed to bullets: no page list, no issue cards. */
function RootTooltip({ data }: { data: RootFlowNode["data"] }) {
  const status = SCAN_STATUS[data.status];
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Chip tone={status.tone}>{status.label}</Chip>
        <span className="text-caption text-smoke">Site</span>
      </div>
      <p className="truncate text-ui font-medium text-white">{data.host}</p>
      <ul className="list-disc space-y-1.5 pl-4 text-caption text-ash marker:text-smoke">
        {data.status === "crawling" && (
          <li>
            {data.pagesRead} {data.pagesRead === 1 ? "page" : "pages"} read so far
          </li>
        )}
        {data.tasks > 0 && (
          <>
            <li>
              {data.runsDone}/{data.runsTotal} runs done ·{" "}
              {VERDICT_ORDER.filter((verdict) => verdict !== "pending" || data.verdicts.pending > 0)
                .map((verdict) => `${data.verdicts[verdict]} ${VERDICT[verdict].label.toLowerCase()}`)
                .join(", ")}
            </li>
            <li>{data.issues === null ? "Counting issues" : `${data.issues} ${data.issues === 1 ? "issue" : "issues"} found`}</li>
          </>
        )}
        {data.status === "failed" && <li className="text-sev-5">{data.message ?? "The scan failed."}</li>}
        {data.taskSource === "fallback" && <li className="text-sev-4">Couldn't read the site; these tasks are generic.</li>}
        {data.taskSource !== "fallback" && data.status !== "failed" && data.status !== "crawling" && data.message && (
          <li className="line-clamp-2">{data.message}</li>
        )}
      </ul>
    </div>
  );
}

export function RootNode({ id, data }: NodeProps<RootFlowNode>) {
  const status = SCAN_STATUS[data.status];
  return (
    <>
      <HoverCard content={<RootTooltip data={data} />}>
        <button
          type="button"
          onClick={() => data.onSelect(id)}
          aria-current={data.selected ? "true" : undefined}
          style={nodeStyle(data.selected)}
          className={`${frame()} ${neutralBorder(data.selected)} flex w-80 flex-col rounded-card border p-5`}
        >
          <span className="flex items-center justify-between gap-2">
            <Chip tone={status.tone}>{status.label}</Chip>
            <span className="text-caption text-smoke">Site</span>
          </span>
          <span className="mt-3 truncate font-heading text-heading-sm text-bone group-hover:text-white">{data.host}</span>

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
                {data.issues === null ? "Counting issues" : `${data.issues} ${data.issues === 1 ? "issue" : "issues"}`} · {data.runsDone}/
                {data.runsTotal} runs done
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
      </HoverCard>
      <CompassHandles type="source" />
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

/** The task panel's key facts, condensed to bullets: no live run pane, no issues list, no control-room link. */
function TaskTooltip({ data }: { data: TaskFlowNode["data"] }) {
  const verdict = VERDICT[taskVerdict(data.state)];
  const stateLabel = data.status === "verifying" ? "Verifying fixes" : SCAN_STATE_LABELS[data.state];
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-body font-semibold tabular-nums tracking-normal text-ash">Task {data.index + 1}</span>
        <Chip tone={verdict.tone}>{verdict.label}</Chip>
      </div>
      <p className="text-ui font-medium leading-snug text-white">{data.title}</p>
      <ul className="list-disc space-y-1.5 pl-4 text-caption text-ash marker:text-smoke">
        <li>
          <span className="text-smoke">Why it matters:</span> {data.whyCritical}
        </li>
        <li>
          <span className="text-smoke">Success looks like:</span> {data.successCheck}
        </li>
        <li>
          {stateLabel} · {data.stepCount}/{MAX_STEPS} steps
        </li>
        <li>
          {data.findingCount} {data.findingCount === 1 ? "finding" : "findings"}
          {data.worst !== null && ` · worst severity S${data.worst}`}
        </li>
      </ul>
    </div>
  );
}

export function TaskNode({ id, data }: NodeProps<TaskFlowNode>) {
  const border = data.worst !== null ? SEVERITY_STYLES[data.worst].box : neutralBorder(data.selected);
  const stateLabel = data.status === "verifying" ? "Verifying fixes" : SCAN_STATE_LABELS[data.state];
  return (
    <>
      {/* target: the spoke in from the sun. source: the spokes out to this task's own issue satellites. */}
      <CompassHandles type="target" />
      <CompassHandles type="source" />
      <HoverCard content={<TaskTooltip data={data} />}>
        <button
          type="button"
          onClick={() => data.onSelect(id)}
          aria-current={data.selected ? "true" : undefined}
          style={nodeStyle(data.selected)}
          className={`${frame()} ${border} flex h-28 w-80 flex-col rounded-2xl border p-3`}
        >
          <span className="flex items-center gap-2">
            <span className="font-mono text-heading-sm font-semibold tabular-nums tracking-normal text-ash">Task {data.index + 1}</span>
            <span className="ml-auto flex items-center gap-1.5 text-caption text-smoke">
              {stateLabel}
              <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
                {data.status === "verifying" ? <Dot tone="glow" size={8} /> : <Mark state={data.state} />}
              </span>
            </span>
          </span>
          <span className="mt-1.5 truncate text-ui leading-snug text-bone group-hover:text-white" title={data.title}>
            {data.title}
          </span>
          <span className="mt-auto flex items-center gap-3 text-caption tabular-nums text-smoke">
            <span title={`${data.stepCount} of ${MAX_STEPS} steps`}>
              {data.stepCount}/{MAX_STEPS} steps
            </span>
            <span>
              <span className={data.findingCount > 0 ? "text-bone" : undefined}>{data.findingCount}</span>{" "}
              {data.findingCount === 1 ? "finding" : "findings"}
            </span>
          </span>
        </button>
      </HoverCard>
    </>
  );
}

/** One issue's key facts, condensed to bullets: no evidence image, no fix list, no "runs" pill row. */
function IssueTooltip({ data }: { data: IssueFlowNode["data"] }) {
  const style = SEVERITY_STYLES[data.severity];
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-caption tabular-nums tracking-normal text-ash">{String(data.rank).padStart(2, "0")}</span>
        <span className={`text-caption tabular-nums ${style.text}`}>
          {data.severity}: {SEVERITY_LABELS[data.severity]}
        </span>
      </div>
      <p className="text-ui font-medium leading-snug text-white">{categoryLabel(data.category)}</p>
      <ul className="list-disc space-y-1.5 pl-4 text-caption text-ash marker:text-smoke">
        {data.summary && <li>{data.summary}</li>}
        <li>
          {data.runsHit}/{data.totalRuns} runs{data.page ? ` · ${pathOf(data.page)}` : ""}
        </li>
      </ul>
    </div>
  );
}

/**
 * One issue this task hit, a small moon trailing it. Clicking selects the
 * task and opens (and scrolls to) that issue's card in the sidebar -- see
 * ScanPage's openIssue and IssueCard's forceOpen.
 */
export function IssueNode({ data }: NodeProps<IssueFlowNode>) {
  const style = SEVERITY_STYLES[data.severity];
  return (
    <>
      <CompassHandles type="target" />
      <HoverCard content={<IssueTooltip data={data} />}>
        <button
          type="button"
          onClick={data.onOpen}
          aria-label={`Issue ${data.rank}: ${categoryLabel(data.category)}, severity ${data.severity} of 5`}
          style={{ backgroundColor: "var(--color-graphite)" }}
          className={`group flex h-15 w-15 shrink-0 items-center justify-center rounded-full border-2 pointer-events-auto transition-transform duration-150 ease-out hover:scale-105 ${style.ring} ${data.focused ? "ring-2 ring-white/70" : ""}`}
        >
          <SeverityIcon severity={data.severity} size={26} className={style.text} />
        </button>
      </HoverCard>
    </>
  );
}
