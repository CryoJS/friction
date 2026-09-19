/**
 * The three node kinds on the scan canvas. Each node is one <button>, so Tab
 * reaches it and Enter selects it; React Flow's own selection, dragging and
 * connecting are off (see ScanGraph).
 *
 * React Flow sets pointer-events: none on nodes that are neither draggable
 * nor selectable, and the property inherits, so every button opts back in
 * with pointer-events-auto.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { PERSONA_BY_ID, type PersonaState } from "@friction/shared";
import { MAX_STEPS } from "../../lib/config";
import { SCAN_STATE_LABELS, SCAN_STATUS, VERDICT, VERDICT_ORDER, personaShortName } from "../../lib/scan";
import type { PersonaFlowNode, RootFlowNode, TaskFlowNode } from "../../lib/scanLayout";
import { Chip, Dot, SEVERITY_STYLES, StateBadge } from "../badges";
import { Check, Cross, PERSONA_GLYPHS } from "../icons";

/** Shared by every node: opaque graphite, text lifts to white on hover, a white ring set 4px off the edge when selected. */
function frame(selected: boolean): string {
  return `group pointer-events-auto bg-graphite text-left transition-colors duration-150 ease-out ${
    selected ? "ring-1 ring-white ring-offset-4 ring-offset-void" : ""
  }`;
}

/** Neutral nodes: a 15% hairline that lifts on hover and goes full strength when selected. */
function neutralBorder(selected: boolean): string {
  return selected ? "border-hairline" : "border-hairline/15 hover:border-hairline/40";
}

export function RootNode({ id, data }: NodeProps<RootFlowNode>) {
  const status = SCAN_STATUS[data.status];
  return (
    <>
      <button
        type="button"
        onClick={() => data.onSelect(id)}
        aria-current={data.selected ? "true" : undefined}
        className={`${frame(data.selected)} ${neutralBorder(data.selected)} flex w-65 flex-col rounded-card border p-4`}
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

        {data.status === "failed" && <span className="mt-2 line-clamp-3 text-caption text-sev-5">{data.message ?? "The scan failed."}</span>}
        {data.taskSource === "fallback" && <span className="mt-2 text-caption text-sev-4">Couldn't read the site; these tasks are generic.</span>}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

/** ✓ / ✗ / … for one persona on a task node, in the system's lights. */
function Mark({ state }: { state: PersonaState }) {
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
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        onClick={() => data.onSelect(id)}
        aria-current={data.selected ? "true" : undefined}
        title={data.title}
        className={`${frame(data.selected)} ${border} flex h-28 w-70 flex-col rounded-2xl border p-3`}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-caption tabular-nums tracking-normal text-ash">T{data.index + 1}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {data.personas.map((p) => {
              const label = `${personaShortName(p.personaId)}: ${SCAN_STATE_LABELS[p.state]}`;
              return (
                <span key={p.personaId} className="flex h-4 w-4 items-center justify-center" title={label}>
                  <Mark state={p.state} />
                  <span className="sr-only">{label}</span>
                </span>
              );
            })}
          </span>
        </span>
        <span className="mt-1.5 line-clamp-2 text-ui leading-snug text-bone group-hover:text-white">{data.title}</span>
        <span className="mt-auto text-caption tabular-nums text-smoke">
          <span className={data.findingCount > 0 ? "text-bone" : undefined}>{data.findingCount}</span>{" "}
          {data.findingCount === 1 ? "finding" : "findings"}
        </span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

export function PersonaNode({ id, data }: NodeProps<PersonaFlowNode>) {
  const Glyph = PERSONA_GLYPHS[data.personaId];
  const findings = `${data.findingCount} ${data.findingCount === 1 ? "finding" : "findings"}`;
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        onClick={() => data.onSelect(id)}
        aria-current={data.selected ? "true" : undefined}
        title={PERSONA_BY_ID[data.personaId].displayName}
        className={`${frame(data.selected)} ${neutralBorder(data.selected)} flex h-11 w-84 items-center gap-2 rounded-full border pl-2.5 pr-2`}
      >
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-icon bg-white text-black">
          <Glyph size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-ui text-bone group-hover:text-white">{personaShortName(data.personaId)}</span>
        <span className="shrink-0 font-mono text-caption tabular-nums tracking-normal text-smoke" title={`${data.stepCount} of ${MAX_STEPS} steps`}>
          {data.stepCount}/{MAX_STEPS}
        </span>
        <span
          className="flex shrink-0 items-center gap-1.5 text-caption tabular-nums text-bone"
          title={data.worst !== null ? `${findings}, worst S${data.worst}` : findings}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${data.worst !== null ? SEVERITY_STYLES[data.worst].dot : "bg-slate"}`} />
          {data.findingCount}
          <span className="sr-only">{data.findingCount === 1 ? "finding" : "findings"}</span>
        </span>
        <StateBadge state={data.state} idleLabel="Queued" />
      </button>
    </>
  );
}
