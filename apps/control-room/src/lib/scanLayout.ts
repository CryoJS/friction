/**
 * Scan tree -> React Flow nodes and edges. Pure. The shape is fixed (root ->
 * tasks -> three personas each), so positions are computed directly, left to
 * right, with no layout library:
 *
 *   root (x 0)  ->  tasks (x 320)  ->  personas (x 660)
 *
 * Each task owns a block of three persona rows; the task sits in the middle
 * of its block and the root in the middle of everything.
 */
import type { Edge, Node } from "@xyflow/react";
import {
  scanNodeId,
  type PersonaId,
  type PersonaState,
  type ScanStatus,
  type ScanTreeResponse,
  type Severity,
  type TaskSource,
  type TaskVerdict,
} from "@friction/shared";
import { hostOf, runProgress, verdictCounts, worstSeverity } from "./scan";

const COLUMN_X = { root: 0, task: 320, persona: 660 } as const;
/** Rendered heights (nodes.tsx: task h-28, persona h-11). The root grows with its content; its height is an estimate used only for centring. */
const ROOT_HEIGHT = 160;
const TASK_HEIGHT = 112;
const PERSONA_HEIGHT = 44;
const PERSONA_PITCH = PERSONA_HEIGHT + 8;
/** Three persona rows. */
const BLOCK = PERSONA_PITCH * 2 + PERSONA_HEIGHT;
const BLOCK_GAP = 32;

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
  /** PERSONAS order. */
  personas: Array<{ personaId: PersonaId; state: PersonaState }>;
  findingCount: number;
  worst: Severity | null;
};

export type PersonaNodeData = Selectable & {
  personaId: PersonaId;
  state: PersonaState;
  stepCount: number;
  findingCount: number;
  worst: Severity | null;
};

export type RootFlowNode = Node<RootNodeData, "root">;
export type TaskFlowNode = Node<TaskNodeData, "task">;
export type PersonaFlowNode = Node<PersonaNodeData, "persona">;
export type ScanFlowNode = RootFlowNode | TaskFlowNode | PersonaFlowNode;

export interface LayoutOptions {
  /** Id of the selected node (see scanNodeId). */
  selected: string;
  issues: number | null;
  onSelect: (nodeId: string) => void;
}

export function layoutScan(tree: ScanTreeResponse, options: LayoutOptions): { nodes: ScanFlowNode[]; edges: Edge[] } {
  const { selected, onSelect } = options;
  const count = tree.tasks.length;
  const contentHeight = count > 0 ? count * (BLOCK + BLOCK_GAP) - BLOCK_GAP : ROOT_HEIGHT;
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
    const top = position * (BLOCK + BLOCK_GAP);
    const taskId = scanNodeId({ kind: "task", index: task.index });
    nodes.push({
      id: taskId,
      type: "task",
      position: { x: COLUMN_X.task, y: top + (BLOCK - TASK_HEIGHT) / 2 },
      data: {
        index: task.index,
        title: task.title,
        personas: task.personas.map((p) => ({ personaId: p.personaId, state: p.state })),
        findingCount: task.personas.reduce((sum, p) => sum + p.findingCount, 0),
        worst: worstSeverity(task.personas),
        selected: selected === taskId,
        onSelect,
      },
    });
    edges.push({ id: `root>${taskId}`, source: "root", target: taskId, type: "smoothstep" });

    task.personas.forEach((persona, row) => {
      const personaNodeId = scanNodeId({ kind: "persona", index: task.index, personaId: persona.personaId });
      nodes.push({
        id: personaNodeId,
        type: "persona",
        position: { x: COLUMN_X.persona, y: top + row * PERSONA_PITCH },
        data: {
          personaId: persona.personaId,
          state: persona.state,
          stepCount: persona.stepCount,
          findingCount: persona.findingCount,
          worst: persona.worstSeverity,
          selected: selected === personaNodeId,
          onSelect,
        },
      });
      edges.push({
        id: `${taskId}>${personaNodeId}`,
        source: taskId,
        target: personaNodeId,
        type: "smoothstep",
        animated: persona.state === "running",
      });
    });
  });

  return { nodes, edges };
}
