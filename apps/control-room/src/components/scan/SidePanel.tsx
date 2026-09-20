import type { ScanNode, ScanReportResponse, ScanTreeResponse } from "@friction/shared";
import { RootPanel } from "./RootPanel";
import { TaskPanel } from "./TaskPanel";

interface Props {
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  node: ScanNode;
  onSelect: (nodeId: string) => void;
  onOpenAnnotation?: (findingId: string) => void;
  /** An issue key to force open in the task panel, e.g. from clicking its satellite on the orbit graph. */
  focusedIssueKey?: string | null;
}

/** The panel for the selected node. A node whose task does not exist (yet) falls back to the site report. */
export function SidePanel({ tree, report, node, onSelect, onOpenAnnotation, focusedIssueKey = null }: Props) {
  const task = node.kind === "root" ? undefined : tree.tasks.find((t) => t.index === node.index);
  if (task) return <TaskPanel key={task.runId} task={task} tree={tree} report={report} onSelect={onSelect} onOpenAnnotation={onOpenAnnotation} focusedIssueKey={focusedIssueKey} />;
  return <RootPanel tree={tree} report={report} onSelect={onSelect} onOpenAnnotation={onOpenAnnotation} />;
}
