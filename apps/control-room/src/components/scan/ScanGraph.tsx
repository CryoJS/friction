/**
 * The scan tree on a pan-and-zoom canvas. Positions come from layoutScan, so
 * nodes are never dragged; the selection lives in the URL, so React Flow's own
 * selection, connecting and delete keys are all off. Each node is a <button>
 * (see nodes.tsx): Tab reaches it and Enter selects it.
 */
import { useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ScanFlowNode } from "../../lib/scanLayout";
import { Minus, Plus } from "../icons";
import { PersonaNode, RootNode, TaskNode } from "./nodes";

const NODE_TYPES: NodeTypes = { root: RootNode, task: TaskNode, persona: PersonaNode };
/** maxZoom 1 keeps a lone site node (while crawling) at its real size. */
const FIT: FitViewOptions = { padding: 0.12, maxZoom: 1 };

/** An animation's length, or 0 when the viewer asked for reduced motion. */
function motion(ms: number): number {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
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
  const { getZoom, screenToFlowPosition, setCenter } = useReactFlow();

  // Tabbing to a node outside the view makes the browser scroll React Flow's
  // overflow-hidden root, which React Flow never notices, so nodes and edges
  // drift apart. Undo any such scroll; reveal() pans the viewport instead.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const reset = (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.scrollTop !== 0 || target.scrollLeft !== 0)) {
        target.scrollTop = 0;
        target.scrollLeft = 0;
      }
    };
    element.addEventListener("scroll", reset, true);
    return () => element.removeEventListener("scroll", reset, true);
  }, []);

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
    if (pane && (pane.scrollTop !== 0 || pane.scrollLeft !== 0)) {
      pane.scrollTop = 0;
      pane.scrollLeft = 0;
    }
    const box = node.getBoundingClientRect();
    const view = event.currentTarget.getBoundingClientRect();
    if (box.left >= view.left && box.right <= view.right && box.top >= view.top && box.bottom <= view.bottom) return;
    const centre = screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    void setCenter(centre.x, centre.y, { zoom: Math.max(getZoom(), 0.6), duration: motion(200) });
  };

  return (
    <div ref={frame} onFocus={reveal} className="scan-flow absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
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
        <FitOnGrow count={nodes.length} />
        <CanvasControls />
      </ReactFlow>
    </div>
  );
}

/** The fitView prop fits once, on load; fit again when the task nodes first appear after the crawl. */
function FitOnGrow({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  const previous = useRef(count);
  useEffect(() => {
    const grew = count > previous.current;
    previous.current = count;
    if (!grew) return;
    // Give React Flow a beat to measure the new nodes before fitting them.
    const timer = window.setTimeout(() => void fitView({ ...FIT, duration: motion(300) }), 80);
    return () => window.clearTimeout(timer);
  }, [count, fitView]);
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
