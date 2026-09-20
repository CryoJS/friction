/**
 * The scan tree on a pan-and-zoom canvas. Positions come from layoutScan, so
 * nodes are never dragged; the selection lives in the URL, so React Flow's own
 * selection, connecting and delete keys are all off. Each node is a <button>
 * (see nodes.tsx): Tab reaches it and Enter selects it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScanReportResponse, ScanTreeResponse } from "@friction/shared";
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
import { SnapshotPanel } from "../SnapshotPanel";
import { IssueNode, OrbitRing, RootNode, TaskNode } from "./nodes";
import { PathView } from "./PathView";

const NODE_TYPES: NodeTypes = { root: RootNode, task: TaskNode, ring: OrbitRing, issue: IssueNode };
/** maxZoom 1 keeps a lone site node (while crawling) at its real size. */
const FIT: FitViewOptions = { padding: 0.12, maxZoom: 1 };
const ANNOTATION_SIDEBAR_MIN = 280;
const ANNOTATION_SIDEBAR_MAX = 560;
const ANNOTATION_SIDEBAR_DEFAULT = 384;

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
  scanId: string;
  refreshKey?: string;
  view: ScanView;
  nodes: ScanFlowNode[];
  edges: Edge[];
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  onSelectNode: (nodeId: string) => void;
  focusedAnnotationId?: string | null;
  annotationPath?: string | null;
  onOpenIssue?: (taskId: string, issueKey: string) => void;
  onOpenAnnotation: (findingId: string) => void;
  onSelectAnnotationPath: (path: string) => void;
}

export type ScanView = "graph" | "path" | "page";

export function ScanGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ scanId, refreshKey, nodes, edges, tree, report, onSelectNode, view, focusedAnnotationId, annotationPath, onOpenIssue, onOpenAnnotation, onSelectAnnotationPath }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [annotationSidebarWidth, setAnnotationSidebarWidth] = useState(ANNOTATION_SIDEBAR_DEFAULT);
  const [resizingAnnotationSidebar, setResizingAnnotationSidebar] = useState(false);
  const { getZoom, screenToFlowPosition, setCenter } = useReactFlow<ScanFlowNode>();

  useEffect(() => {
    if (!resizingAnnotationSidebar) return;
    const move = (event: PointerEvent): void => {
      const bounds = frame.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = event.clientX - bounds.left;
      setAnnotationSidebarWidth(Math.min(ANNOTATION_SIDEBAR_MAX, Math.max(ANNOTATION_SIDEBAR_MIN, width)));
    };
    const stop = (): void => setResizingAnnotationSidebar(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [resizingAnnotationSidebar]);

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
  // keyed by node id. `nodes` is a controlled prop -- React Flow re-syncs
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
      if (event.target instanceof HTMLElement && event.target.classList.contains("react-flow")) unscroll(event.target);
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
  // bumping nudgeTick to fold it into measuredNodes above. It is paused while
  // the graph is hidden because React Flow is unmounted then.
  useEffect(() => {
    nudgeOffsets.current.clear();
    clearAllNudge();
    setNudgeTick((value) => value + 1);
    if (view !== "graph" || reducedMotion()) return;

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
  }, [screenToFlowPosition, view]);

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
      {view === "graph" ? (
        <div id="scan-tasks-graph-panel" role="tabpanel" aria-labelledby="scan-tasks-graph-tab" className="absolute inset-0">
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
      ) : view === "path" ? (
        <div id="scan-web-paths-panel" role="tabpanel" aria-labelledby="scan-web-paths-tab" className="absolute inset-0">
          <PathView tree={tree} report={report} onSelectNode={onSelectNode} onOpenIssue={onOpenIssue} />
        </div>
      ) : (
        <div id="scan-annotations-panel" role="tabpanel" aria-labelledby="scan-annotations-tab" className="absolute inset-0">
          <div className="absolute inset-0 flex min-h-0 flex-col lg:flex-row">
            <div
              className="annotation-sidebar-resizable relative h-64 w-full min-w-0 shrink-0 lg:h-auto"
              style={{ "--annotation-sidebar-width": annotationSidebarWidth + "px" } as React.CSSProperties}
            >
              <aside aria-label="Web paths" className="relative h-full w-full border-b border-hairline/10 lg:border-b-0">
                <PathView
                  tree={tree}
                  report={report}
                  onSelectNode={onSelectNode}
                  onOpenAnnotation={onOpenAnnotation}
                  onSelectPath={onSelectAnnotationPath}
                  sidebar
                />
              </aside>
              <div
                role="separator"
                aria-label="Resize annotations paths panel"
                aria-orientation="vertical"
                aria-valuemin={ANNOTATION_SIDEBAR_MIN}
                aria-valuemax={ANNOTATION_SIDEBAR_MAX}
                aria-valuenow={Math.round(annotationSidebarWidth)}
                tabIndex={0}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setResizingAnnotationSidebar(true);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 24 : -24;
                  setAnnotationSidebarWidth((current) => Math.min(ANNOTATION_SIDEBAR_MAX, Math.max(ANNOTATION_SIDEBAR_MIN, current + delta)));
                }}
                className="group absolute inset-y-0 right-0 z-20 hidden w-2 cursor-col-resize touch-none lg:block"
              >
                <span className="absolute inset-y-0 right-0 w-px bg-hairline/15 transition-colors group-hover:bg-white/60" />
              </div>
            </div>
            <div className="min-h-0 min-w-0 flex-1">
              <SnapshotPanel scanId={scanId} refreshKey={refreshKey} focusedFindingId={focusedAnnotationId} focusedPath={annotationPath} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ScanViewTabs({ view, onChange }: { view: ScanView | null; onChange: (view: ScanView) => void }) {
  const views: ScanView[] = ["graph", "path", "page"];
  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, current: ScanView) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = views.indexOf(current);
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = views[(index + offset + views.length) % views.length] ?? "graph";
    onChange(next);
    window.requestAnimationFrame(() => document.getElementById(scanViewTabId(next))?.focus());
  };

  return (
    <div role="tablist" aria-label="Scan view" className="scan-view-tabs flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-hairline/15 bg-white/4 p-1">
      <button
        id="scan-tasks-graph-tab"
        type="button"
        role="tab"
        aria-selected={view === "graph"}
        aria-controls="scan-tasks-graph-panel"
        tabIndex={view === null ? 0 : view === "graph" ? 0 : -1}
        onClick={() => onChange("graph")}
        onKeyDown={(event) => moveTab(event, "graph")}
        className="scan-view-tab pill-ghost h-8 shrink-0 border-transparent px-3 text-caption"
      >
        Tasks
      </button>
      <button
        id="scan-web-paths-tab"
        type="button"
        role="tab"
        aria-selected={view === "path"}
        aria-controls="scan-web-paths-panel"
        tabIndex={view === "path" ? 0 : -1}
        onClick={() => onChange("path")}
        onKeyDown={(event) => moveTab(event, "path")}
        className="scan-view-tab pill-ghost h-8 shrink-0 border-transparent px-3 text-caption"
      >
        Paths
      </button>
      <button
        id="scan-annotations-tab"
        type="button"
        role="tab"
        aria-selected={view === "page"}
        aria-controls="scan-annotations-panel"
        tabIndex={view === "page" ? 0 : -1}
        onClick={() => onChange("page")}
        onKeyDown={(event) => moveTab(event, "page")}
        className="scan-view-tab pill-ghost h-8 shrink-0 border-transparent px-3 text-caption"
      >
        Annotations
      </button>
    </div>
  );
}

function scanViewTabId(view: ScanView): string {
  return view === "graph" ? "scan-tasks-graph-tab" : view === "path" ? "scan-web-paths-tab" : "scan-annotations-tab";
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
