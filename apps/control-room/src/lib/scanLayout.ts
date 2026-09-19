/**
 * Scan tree -> React Flow nodes and edges. Pure. The shape is fixed (root ->
 * tasks, one run each), so positions are computed directly, left to right,
 * with no layout library:
 *
 *   root (x 0)  ->  tasks (x 320)
 *
 * Tasks stack top to bottom in rank order; the root sits in the middle of them.
 */
import type { Edge, Node } from "@xyflow/react";
import {
  scanNodeId,
  type AgentState,
  type RunStatus,
  type ScanStatus,
  type ScanTreeResponse,
  type Severity,
  type TaskSource,
  type TaskVerdict,
} from "@friction/shared";
import { hostOf, runProgress, verdictCounts } from "./scan";

const COLUMN_X = { root: 0, task: 320 } as const;
/** Rendered heights (nodes.tsx: task h-28). The root grows with its content; its height is an estimate used only for centring. */
const ROOT_HEIGHT = 160;
const TASK_HEIGHT = 112;
const TASK_GAP = 20;

type Selectable = { selected: boolean; onSelect: (nodeId: string) => void };

export type RootNodeData = Selectable & {
  host: string;
  status: ScanStatus;
  message: string | null;
  pagesRead: number;
  taskSource: TaskSource | null;
  tasks: number;
  verdicts: Record<TaskVerdict, number>;
  runsDone: number;
  runsTotal: number;
  /** Merged issue count from the report, once it has arrived. */
  issues: number | null;
};

export type TaskNodeData = Selectable & {
  index: number;
  title: string;
  status: RunStatus;
  state: AgentState;
  stepCount: number;
  findingCount: number;
  worst: Severity | null;
};

export type RootFlowNode = Node<RootNodeData, "root">;
export type TaskFlowNode = Node<TaskNodeData, "task">;
export type ScanFlowNode = RootFlowNode | TaskFlowNode;

export interface LayoutOptions {
  /** Id of the selected node (see scanNodeId). */
  selected: string;
  issues: number | null;
  onSelect: (nodeId: string) => void;
}

export function layoutScan(tree: ScanTreeResponse, options: LayoutOptions): { nodes: ScanFlowNode[]; edges: Edge[] } {
  const { selected, onSelect } = options;
  const count = tree.tasks.length;
  const contentHeight = count > 0 ? count * (TASK_HEIGHT + TASK_GAP) - TASK_GAP : ROOT_HEIGHT;
  const progress = runProgress(tree);

  const nodes: ScanFlowNode[] = [
    {
      id: "root",
      type: "root",
      position: { x: COLUMN_X.root, y: (contentHeight - ROOT_HEIGHT) / 2 },
      data: {
        host: hostOf(tree.scan.url),
        status: tree.scan.status,
        message: tree.scan.message,
        pagesRead: tree.scan.pages.length,
        taskSource: tree.scan.taskSource,
        tasks: count,
        verdicts: verdictCounts(tree),
        runsDone: progress.done,
        runsTotal: progress.total,
        issues: options.issues,
        selected: selected === "root",
        onSelect,
      },
    },
  ];
  const edges: Edge[] = [];

  tree.tasks.forEach((task, position) => {
    const taskId = scanNodeId({ kind: "task", index: task.index });
    nodes.push({
      id: taskId,
      type: "task",
      position: { x: COLUMN_X.task, y: position * (TASK_HEIGHT + TASK_GAP) },
      data: {
        index: task.index,
        title: task.title,
        status: task.status,
        state: task.state,
        stepCount: task.stepCount,
        findingCount: task.findingCount,
        worst: task.worstSeverity,
        selected: selected === taskId,
        onSelect,
      },
    });
    edges.push({ id: `root>${taskId}`, source: "root", target: taskId, type: "smoothstep", animated: task.state === "running" });
  });

  return { nodes, edges };
}
