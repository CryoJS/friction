import type { ScanNode, ScanReportResponse, ScanTreeResponse } from "@friction/shared";
import { RootPanel } from "./RootPanel";
import { TaskPanel } from "./TaskPanel";

interface Props {
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  node: ScanNode;
  onSelect: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

/** The panel for the selected node. A node whose task does not exist (yet) falls back to the site report. */
export function SidePanel({ tree, report, node, onSelect, onOpenRun }: Props) {
  const task = node.kind === "root" ? undefined : tree.tasks.find((t) => t.index === node.index);
  if (task) return <TaskPanel key={task.runId} task={task} tree={tree} report={report} onSelect={onSelect} onOpenRun={onOpenRun} />;
  return <RootPanel tree={tree} report={report} onSelect={onSelect} />;
}
