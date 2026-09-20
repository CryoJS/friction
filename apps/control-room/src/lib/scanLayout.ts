/**
 * Scan tree -> React Flow nodes and edges. Pure. The shape is fixed (root ->
 * tasks -> the issues each task hit, one run per task), laid out as an orbit
 * rather than a tree:
 *
 *   the site sits at the centre, its sun; each task is a planet on an orbit
 *   around it, evenly spaced by rank. The orbit is oval, not a true circle
 *   (ORBIT_ASPECT below) -- wider than it is tall, to suit a canvas that is
 *   itself wider than tall -- so a planet's *distance* from the sun, not a
 *   literal radius, carries the meaning: the worse the friction found on
 *   that task, the closer it pulls in toward the sun; a task with no
 *   findings yet drifts out to the rim. That distance is "somewhat
 *   consistent" for a given severity rather than exactly equal in every
 *   direction, since the oval is narrower along one axis than the other.
 *   Concentric dashed ovals (see OrbitRing in nodes.tsx) mark the distances
 *   actually in use, so at a glance the whole graph reads as a heat map: a
 *   tight, crowded inner oval means trouble, an empty one means the site is
 *   clean there.
 *
 *   Each task's own issues (from the merged site report) fan out further,
 *   as small moons trailing it, away from the sun, spread like a snowflake's
 *   spikes -- see issueAngles. A spike's own length is severity again, and
 *   it too rides a mild oval stretch (ISSUE_ASPECT) rather than sitting on a
 *   perfect ring around its task.
 *
 * Root and task nodes each carry one handle per compass side (see nodes.tsx);
 * an edge picks whichever pair of opposite sides its two nodes' angle calls
 * for, so a spoke reads as a straight line no matter where its target sits.
 *
 * Every distance and gap below is checked against the actual node sizes
 * rendered in nodes.tsx (noted alongside each constant), for MAX_SCAN_TASKS
 * (5) tasks at the same severity, the tightest case there is -- see the
 * overlap check described alongside RADIUS_BY_SEVERITY and ISSUE_ASPECT.
 * fitView scales the whole picture to the viewport regardless of these
 * numbers' absolute size, so there is no cost to erring on the roomy side.
 */
import type { Edge, Node } from "@xyflow/react";
import {
  scanNodeId,
  type AgentState,
  type FrictionCategory,
  type RunStatus,
  type ScanReportResponse,
  type ScanStatus,
  type ScanTreeResponse,
  type Severity,
  type TaskSource,
  type TaskVerdict,
} from "@friction/shared";
import type { Tone } from "../components/badges";
import { TASK_PR, coveredByLabel, hostOf, rankedIssuesForTask, runProgress, verdictCounts } from "./scan";

/**
 * React Flow positions every node by its top-left corner, but every distance
 * below (a radius, an orbit distance) is measured the way an orbit actually
 * works: centre to centre. So each node's centre is computed first, on the
 * true circle, and only converted to a top-left position -- by subtracting
 * half its own rendered size -- right before it's placed in the node list.
 * Sizes here must match what nodes.tsx actually renders, noted alongside
 * each. Getting this wrong doesn't just look slightly off: a node whose
 * *centre* is a safe distance from another can still have its own bounding
 * box overlap it, once that node is wide enough (a task is 320x112) --
 * exactly the bug this centre-first approach exists to avoid.
 */
export const TASK_SIZE = { w: 320, h: 112 } as const; // nodes.tsx: task w-80 h-28
const ROOT_SIZE = { w: 320, h: 190 } as const; // nodes.tsx: root w-80; height grows with content, this is a rough middle estimate used only for centring
/** The sun's approximate centre; every orbit is measured from here, not from the root node's top-left (0,0). */
const ORBIT_CENTER = { x: ROOT_SIZE.w / 2, y: ROOT_SIZE.h / 2 };

/**
 * The orbit's oval stretch: wider along x, narrower along y, applied to
 * every task distance below. Chosen, then RADIUS_BY_SEVERITY's minimum was
 * re-verified against it (not just carried over from the old circular
 * numbers): for 5 same-severity tasks plus the root, every pair of node
 * rectangles -- root-task and task-task -- was checked at this aspect for
 * the smallest distance that still clears them all. 290 is that check's
 * result (259px) plus a 20px margin, most of it against the root, the
 * closer pair even at this distance.
 */
const ORBIT_ASPECT = { x: 1.25, y: 0.85 };

/** A task with no findings (yet) orbits at the rim; 5 is the tightest, most-critical oval. */
const OUTER_RADIUS = 400;
const RADIUS_BY_SEVERITY: Readonly<Record<Severity, number>> = { 5: 290, 4: 310, 3: 330, 2: 350, 1: 370 };
/** 12 o'clock, then clockwise by rank -- rank 0 (the worst-ranked task) leads at the top. */
const ANGLE_OFFSET = -Math.PI / 2;

function orbitRadius(worst: Severity | null): number {
  return worst === null ? OUTER_RADIUS : RADIUS_BY_SEVERITY[worst];
}

/**
 * An issue satellite is a 60px circle (nodes.tsx: issue h-15 w-15), trailing
 * its task away from the sun. The fan's outward bearing can point toward the
 * task's corner, up to sqrt(160^2+56^2) =~ 170px from its centre, so every
 * orbit distance below clears that corner plus the satellite's own radius
 * and gap rather than just the task's half-width (which a purely circular
 * clearance check would have used, and which undershot on a diagonal
 * bearing).
 *
 * Distance carries the same meaning it does for a task's own ring: the worse
 * the issue, the closer it sits to what caused it. 5 is the closest, tightest
 * spike; 1 trails the farthest out. ISSUE_DIST_MIN (severity 5's distance) is
 * also the one used to work out how far apart two satellites need to be
 * angularly (issueAngles): it's the smallest distance any satellite can be
 * placed at, so it's the tightest-packed, worst-case ring to check.
 */
/**
 * The issue fan's own, milder oval stretch -- applied to ISSUE_DIST_BY_SEVERITY
 * below so a task's satellites don't sit on a perfect ring either. Both
 * factors are >= 1 (only ever stretched outward, never squeezed in), which
 * is what lets this reuse ISSUE_DIST_MIN's existing safety margin rather
 * than re-deriving it: scaling a vector's x by a and its y by b, both >= 1,
 * can only ever lengthen it, whatever direction it pointed in, so every
 * distance below is still at least as far from the task as the plain
 * circular minimum that margin was checked against.
 */
const ISSUE_ASPECT = { x: 1.2, y: 1.05 };

export const ISSUE_DIAMETER = 60;
const ISSUE_GAP = 14;
const ISSUE_DIST_MIN = 170 + ISSUE_DIAMETER / 2 + ISSUE_GAP;
const ISSUE_DIST_BY_SEVERITY: Readonly<Record<Severity, number>> = {
  5: ISSUE_DIST_MIN,
  4: ISSUE_DIST_MIN + 16,
  3: ISSUE_DIST_MIN + 32,
  2: ISSUE_DIST_MIN + 48,
  1: ISSUE_DIST_MIN + 64,
};
/** How wide, in the best case, a task's issues fan out -- a snowflake's spikes, not a narrow cone. Angular spacing still yields to ISSUE_DIST_MIN's safety minimum when there are enough issues to need it. */
const ISSUE_FAN_TARGET = (34 * Math.PI) / 180;
const ISSUE_FAN_MAX = (170 * Math.PI) / 180;

/** A node's centre on the orbit, converted to the top-left position React Flow wants. */
function topLeft(center: { x: number; y: number }, size: { w: number; h: number }): { x: number; y: number } {
  return { x: center.x - size.w / 2, y: center.y - size.h / 2 };
}

type Side = "top" | "right" | "bottom" | "left";
const OPPOSITE: Readonly<Record<Side, Side>> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** Which compass side of a node an edge should leave from / arrive at, for a given angle from its centre. */
function sideOf(angle: number): Side {
  const deg = ((angle * 180) / Math.PI + 360) % 360;
  if (deg < 45 || deg >= 315) return "right";
  if (deg < 135) return "bottom";
  if (deg < 225) return "left";
  return "top";
}

/**
 * n points around a task, fanned out on either side of its own outward
 * bearing (away from the sun) like a snowflake's spikes: spread wide
 * (ISSUE_FAN_TARGET apart) when there's room, packed only as tight as
 * ISSUE_DIST_MIN's clearance actually requires when there isn't, and never
 * wider overall than ISSUE_FAN_MAX (so a task with many issues still fans
 * outward, never wrapping back around toward the sun or a neighbour).
 */
function issueAngles(n: number, outward: number): number[] {
  if (n <= 1) return [outward];
  const minStep = 2 * Math.asin(Math.min(1, (ISSUE_DIAMETER + ISSUE_GAP) / (2 * ISSUE_DIST_MIN)));
  const step = Math.max(minStep, Math.min(ISSUE_FAN_TARGET, ISSUE_FAN_MAX / (n - 1)));
  const start = outward - (step * (n - 1)) / 2;
  return Array.from({ length: n }, (_, i) => start + i * step);
}

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
  whyCritical: string;
  successCheck: string;
  /** The task's pull request chip, once it has an outcome. */
  pullRequest: { label: string; tone: Tone; title?: string } | null;
};

export type RingNodeData = { radiusX: number; radiusY: number };

export type IssueNodeData = {
  category: FrictionCategory;
  severity: Severity;
  /** 1-based position in the site report's ranking. */
  rank: number;
  summary: string | null;
  page: string;
  runsHit: number;
  totalRuns: number;
  focused: boolean;
  onOpen: () => void;
};

export type RootFlowNode = Node<RootNodeData, "root">;
export type TaskFlowNode = Node<TaskNodeData, "task">;
export type RingFlowNode = Node<RingNodeData, "ring">;
export type IssueFlowNode = Node<IssueNodeData, "issue">;
export type ScanFlowNode = RootFlowNode | TaskFlowNode | RingFlowNode | IssueFlowNode;

export interface LayoutOptions {
  /** Id of the selected node (see scanNodeId). */
  selected: string;
  issues: number | null;
  report: ScanReportResponse | null;
  /** The issue key, if any, a satellite click asked the sidebar to open. */
  focusedIssueKey: string | null;
  onSelect: (nodeId: string) => void;
  /** A satellite click: selects its task and asks the sidebar to open that specific issue. */
  onSelectIssue: (taskId: string, issueKey: string) => void;
}

export function layoutScan(tree: ScanTreeResponse, options: LayoutOptions): { nodes: ScanFlowNode[]; edges: Edge[] } {
  const { selected, report, focusedIssueKey, onSelect, onSelectIssue } = options;
  const count = tree.tasks.length;
  const progress = runProgress(tree);

  const rootNode: RootFlowNode = {
    id: "root",
    type: "root",
    position: { x: 0, y: 0 },
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
  };

  const taskNodes: TaskFlowNode[] = [];
  const issueNodes: IssueFlowNode[] = [];
  const edges: Edge[] = [];
  const ringRadii = new Set<number>();

  tree.tasks.forEach((task, position) => {
    const taskId = scanNodeId({ kind: "task", index: task.index });
    const pr = tree.pullRequests?.find((candidate) => candidate.runId === task.runId);
    const angle = ANGLE_OFFSET + (position / count) * 2 * Math.PI;
    const radius = orbitRadius(task.worstSeverity);
    ringRadii.add(radius);
    const rootSide = sideOf(angle);
    const taskCenter = { x: ORBIT_CENTER.x + Math.cos(angle) * radius * ORBIT_ASPECT.x, y: ORBIT_CENTER.y + Math.sin(angle) * radius * ORBIT_ASPECT.y };

    taskNodes.push({
      id: taskId,
      type: "task",
      position: topLeft(taskCenter, TASK_SIZE),
      data: {
        index: task.index,
        title: task.title,
        status: task.status,
        state: task.state,
        stepCount: task.stepCount,
        findingCount: task.findingCount,
        worst: task.worstSeverity,
        whyCritical: task.whyCritical,
        successCheck: task.successCheck,
        pullRequest: pr ? { label: pr.status === "covered" ? coveredByLabel(pr.coveredBy) : TASK_PR[pr.status].label, tone: TASK_PR[pr.status].tone, title: pr.reason } : null,
        selected: selected === taskId,
        onSelect,
      },
    });
    edges.push({
      id: `root>${taskId}`,
      source: "root",
      sourceHandle: rootSide,
      target: taskId,
      targetHandle: OPPOSITE[rootSide],
      type: "straight",
      animated: task.state === "running",
    });

    // The task's own issues, fanned out further from the sun as small moons.
    const ranked = rankedIssuesForTask(report, task.index);
    const angles = issueAngles(ranked.length, angle);
    ranked.forEach(({ issue, rank }, i) => {
      // An issue can span several tasks (the same friction, hit by more than one run), so its
      // node id is scoped to this task: one moon per task it actually hit, not one shared moon.
      const issueId = `${taskId}>issue-${issue.key}`;
      const issueAngle = angles[i] ?? angle;
      const issueSide = sideOf(issueAngle);
      const issueDist = ISSUE_DIST_BY_SEVERITY[issue.severity];
      const issueCenter = { x: taskCenter.x + Math.cos(issueAngle) * issueDist * ISSUE_ASPECT.x, y: taskCenter.y + Math.sin(issueAngle) * issueDist * ISSUE_ASPECT.y };
      issueNodes.push({
        id: issueId,
        type: "issue",
        position: topLeft(issueCenter, { w: ISSUE_DIAMETER, h: ISSUE_DIAMETER }),
        data: {
          category: issue.category,
          severity: issue.severity,
          rank,
          summary: issue.summary,
          page: issue.page,
          runsHit: issue.runsHit,
          totalRuns: issue.totalRuns,
          focused: issue.key === focusedIssueKey,
          onOpen: () => onSelectIssue(taskId, issue.key),
        },
      });
      edges.push({
        id: `edge:${issueId}`,
        source: taskId,
        sourceHandle: issueSide,
        target: issueId,
        targetHandle: OPPOSITE[issueSide],
        type: "straight",
        style: { stroke: "rgb(229 229 229 / 0.28)", strokeWidth: 1.25 },
      });
    });
  });

  // One dashed oval per distance actually in use, centred on the sun and drawn behind everything else.
  const ringNodes: RingFlowNode[] = [...ringRadii].map((radius) => ({
    id: `ring-${radius}`,
    type: "ring",
    position: topLeft(ORBIT_CENTER, { w: radius * 2 * ORBIT_ASPECT.x, h: radius * 2 * ORBIT_ASPECT.y }),
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: -1,
    data: { radiusX: radius * ORBIT_ASPECT.x, radiusY: radius * ORBIT_ASPECT.y },
  }));

  return { nodes: [...ringNodes, rootNode, ...taskNodes, ...issueNodes], edges };
}
