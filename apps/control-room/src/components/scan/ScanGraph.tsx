/**
 * The scan tree on a pan-and-zoom canvas. Positions come from layoutScan, so
 * nodes are never dragged; the selection lives in the URL, so React Flow's own
 * selection, connecting and delete keys are all off. Each node is a <button>
 * (see nodes.tsx): Tab reaches it and Enter selects it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ISSUE_DIAMETER, TASK_SIZE, type ScanFlowNode } from "../../lib/scanLayout";
import { clearAllNudge, reducedMotion, stepNudge, type NudgeTarget } from "../../lib/nudge";
import { Minus, Plus } from "../icons";
import { IssueNode, OrbitRing, RootNode, TaskNode } from "./nodes";

const NODE_TYPES: NodeTypes = { root: RootNode, task: TaskNode, ring: OrbitRing, issue: IssueNode };
/** maxZoom 1 keeps a lone site node (while crawling) at its real size. */
const FIT: FitViewOptions = { padding: 0.12, maxZoom: 1 };

/** An animation's length, or 0 when the viewer asked for reduced motion. */
function motion(ms: number): number {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}

/** Zero an element's scroll offset if the browser (or anything else) has nudged it off (0, 0). */
function unscroll(element: HTMLElement): void {
  if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
    element.scrollTop = 0;
    element.scrollLeft = 0;
  }
}

interface Props {
  nodes: ScanFlowNode[];
  edges: Edge[];
}

export function ScanGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ nodes, edges }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const { getZoom, screenToFlowPosition, setCenter } = useReactFlow<ScanFlowNode>();

  // Every poll rebuilds every node as a brand-new object (layoutScan is
  // pure), so React Flow's adoptUserNodes never sees the same reference twice
  // and resets `measured` to { width: undefined, height: undefined } -- which
  // hides the node (visibility: hidden) and drops its handle bounds (so
  // edges lose their anchor) until the ResizeObserver fires again, a couple
  // of frames later, on every single poll. onNodesChange reports each node's
  // real size once React Flow measures it; keep the latest one per id here
  // and stamp it onto every incoming node before it reaches <ReactFlow>, so
  // a node already on screen never goes back to unmeasured.
  const measuredSizes = useRef(new Map<string, { width?: number; height?: number }>());

  const handleNodesChange = useCallback((changes: NodeChange<ScanFlowNode>[]) => {
    for (const change of changes) {
      if (change.type === "dimensions" && change.dimensions) {
        measuredSizes.current.set(change.id, change.dimensions);
      }
    }
  }, []);

  // The cursor-repel nudge's current offsets (see nudge.ts), in flow units,
  // keyed by node id. `nodes` is a *controlled* prop -- React Flow re-syncs
  // its own internal store from it, which would silently undo any position
  // written through the imperative setNodes API -- so the only reliable way
  // to move a node (and have its edges, which React Flow derives from
  // position + handle offsets, follow) is to fold the offset into this same
  // controlled array. `nudgeTick` exists only to make that recompute: it
  // changes every frame something is actively displaced, and nothing else
  // reads its value.
  const nudgeOffsets = useRef(new Map<string, { dx: number; dy: number }>());
  const [nudgeTick, setNudgeTick] = useState(0);

  const measuredNodes = useMemo<ScanFlowNode[]>(
    () =>
      nodes.map((node) => {
        const measured = measuredSizes.current.get(node.id) ?? node.measured;
        const offset = nudgeOffsets.current.get(node.id);
        if (!offset) return { ...node, measured };
        return { ...node, measured, position: { x: node.position.x + offset.dx, y: node.position.y + offset.dy }, style: { ...node.style, transition: "none" } };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nudgeTick is the trigger; nudgeOffsets.current is read fresh each call, never itself a dep.
    [nodes, nudgeTick],
  );

  // Tabbing to a node outside the view makes the browser scroll React Flow's
  // overflow-hidden root, which React Flow never notices, so nodes and edges
  // drift apart. Undo any such scroll; reveal() pans the viewport instead.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const reset = (event: Event): void => {
      if (event.target instanceof HTMLElement) unscroll(event.target);
    };
    element.addEventListener("scroll", reset, true);
    return () => element.removeEventListener("scroll", reset, true);
  }, []);

  // The latest layout, for the physics loop below to read without becoming
  // a dependency that would restart the loop's effect on every poll.
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Cursor position, in screen (client) coordinates, from pointer movement
  // over the canvas pane; leaving the pane relaxes every node back to rest.
  const cursor = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const move = (event: PointerEvent) => {
      cursor.current = { x: event.clientX, y: event.clientY };
    };
    const leave = () => {
      cursor.current = null;
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
    };
  }, []);

  // Runs the spring every frame and writes the result into nudgeOffsets,
  // bumping nudgeTick to fold it into measuredNodes above -- see that
  // comment for why this can't just call the imperative setNodes instead.
  // Off entirely under reduced motion, and only ever touches task and issue
  // node types -- the root and its rings are never nudged.
  useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0;
    const tick = () => {
      const targets: NudgeTarget[] = [];
      for (const node of nodesRef.current) {
        if (node.type === "task") targets.push({ id: node.id, kind: "task", cx: node.position.x + TASK_SIZE.w / 2, cy: node.position.y + TASK_SIZE.h / 2 });
        else if (node.type === "issue") targets.push({ id: node.id, kind: "issue", cx: node.position.x + ISSUE_DIAMETER / 2, cy: node.position.y + ISSUE_DIAMETER / 2 });
      }
      const cursorFlow = cursor.current ? screenToFlowPosition(cursor.current) : null;
      const results = stepNudge(targets, cursorFlow);
      const next = new Map<string, { dx: number; dy: number }>();
      for (const [id, result] of results) if (result.active) next.set(id, { dx: result.dx, dy: result.dy });
      const changed = next.size > 0 || nudgeOffsets.current.size > 0;
      nudgeOffsets.current = next;
      if (changed) setNudgeTick((value) => value + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearAllNudge();
    };
  }, [screenToFlowPosition]);

  /** Keyboard focus on a node outside the view pans that node into the middle. */
  const reveal = (event: React.FocusEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(":focus-visible")) return;
    const node = target.closest(".react-flow__node");
    if (!node) return;
    // The browser's own "scroll the focused element into view" step can land
    // before this handler runs, shifting the pane's scrollTop/scrollLeft off
    // zero. That offset moves everything measured below (and confuses
    // screenToFlowPosition, which assumes an unscrolled pane), so undo it
    // before measuring rather than waiting on the separate scroll listener.
    const pane = event.currentTarget.querySelector<HTMLElement>(".react-flow");
    if (pane) unscroll(pane);
    const box = node.getBoundingClientRect();
    const view = event.currentTarget.getBoundingClientRect();
    if (box.left >= view.left && box.right <= view.right && box.top >= view.top && box.bottom <= view.bottom) return;
    const centre = screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    void setCenter(centre.x, centre.y, { zoom: Math.max(getZoom(), 0.6), duration: motion(200) });
  };

  return (
    <div ref={frame} onFocus={reveal} className="scan-flow absolute inset-0">
      <ReactFlow
        nodes={measuredNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        colorMode="dark"
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        panActivationKeyCode={null}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={FIT}
        minZoom={0.15}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgb(229 229 229 / 0.12)" />
        <FitOnGrow count={measuredNodes.length} />
        <CanvasControls />
      </ReactFlow>
    </div>
  );
}

/**
 * The fitView prop fits once, on load; fit again when the task nodes first
 * appear after the crawl. A grow is only *acted on* once useNodesInitialized
 * reports every node measured -- firing fitView the moment the count grows
 * races the newly-mounted nodes' own ResizeObserver callbacks, so fitView
 * would see them as zero-sized and either skip them or fit to the root
 * alone. `pending` survives across renders where nodesInitialized is still
 * false; measuring 41 nodes is not instantaneous, so nodesInitialized can
 * flip false again right after a growth is first seen true (a stale read,
 * before the store has processed the new nodes), which cancels this timer
 * via the effect's own cleanup -- so `pending` is cleared only once the fit
 * actually runs, not merely once it is scheduled, letting a cancelled
 * attempt retry on the next settle instead of being silently dropped.
 */
function FitOnGrow({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const lastCount = useRef(count);
  const pending = useRef(false);

  useEffect(() => {
    if (count > lastCount.current) pending.current = true;
    lastCount.current = count;
    if (!pending.current || !nodesInitialized) return;
    // Give React Flow a beat to settle the freshly measured layout before fitting it.
    const timer = window.setTimeout(() => {
      pending.current = false;
      void fitView({ ...FIT, duration: motion(300) });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [count, nodesInitialized, fitView]);
  return null;
}

/** Zoom and fit as ghost pills on a graphite pill, in place of React Flow's square controls. */
function CanvasControls() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  return (
    <Panel position="bottom-left" className="flex items-center gap-0.5 rounded-full border border-hairline/15 bg-graphite/90 p-1 backdrop-blur-xs">
      <button type="button" onClick={() => void zoomIn({ duration: motion(160) })} className="pill-ghost h-8 w-8 border-transparent px-0" aria-label="Zoom in" title="Zoom in">
        <Plus size={14} />
      </button>
      <button type="button" onClick={() => void zoomOut({ duration: motion(160) })} className="pill-ghost h-8 w-8 border-transparent px-0" aria-label="Zoom out" title="Zoom out">
        <Minus size={14} />
      </button>
      <button type="button" onClick={() => void fitView({ ...FIT, duration: motion(300) })} className="pill-ghost h-8 border-transparent px-3 text-caption">
        Fit
      </button>
    </Panel>
  );
}
