import { useMemo } from "react";
import { parseScanNode, scanNodeId } from "@friction/shared";
import { useScan } from "../../hooks/useScan";
import { useScanReport } from "../../hooks/useScanReport";
import { resolveScanNode, runProgress, totalFindings } from "../../lib/scan";
import { layoutScan } from "../../lib/scanLayout";
import { Dot } from "../badges";
import { ScanBar } from "./ScanBar";
import { ScanGraph } from "./ScanGraph";
import { SidePanel } from "./SidePanel";
import { RootPanel } from "./RootPanel";

interface Props {
  scanId: string;
  nodeId: string | null;
  view: "scan" | "results";
  /** Must be stable (useCallback): it is baked into every node's data. */
  onSelectNode: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

export function ScanPage({ scanId, nodeId, view, onSelectNode, onOpenRun }: Props) {
  const { tree, stale, missing } = useScan(scanId);
  // Refetch the report when findings arrive, a run finishes, the tasks appear, or the status changes.
  const refreshKey = tree ? `${totalFindings(tree)}:${runProgress(tree).done}:${tree.tasks.length}:${tree.scan.status}` : "none";
  const { report } = useScanReport(scanId, refreshKey);
  const node = tree ? resolveScanNode(parseScanNode(nodeId), tree) : parseScanNode(nodeId);
  const selected = scanNodeId(node);
  const issueCount = report ? report.issues.length : null;

  const graph = useMemo(
    () => (tree ? layoutScan(tree, { selected, issues: issueCount, onSelect: onSelectNode }) : null),
    [tree, selected, issueCount, onSelectNode],
  );

  if (missing) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pt-20 text-center">
        <p className="text-body text-bone">This scan was not found.</p>
        <p className="font-mono text-caption tracking-normal text-smoke">{scanId}</p>
      </main>
    );
  }

  if (!tree || !graph) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pt-20 text-body text-smoke" aria-busy={!stale}>
        {stale ? (
          <span className="flex items-center gap-2">
            <Dot tone="warn" size={7} pulse />
            The Worker is not answering. Retrying every 2 seconds…
          </span>
        ) : (
          <>
            <div className="wash wash-sweep h-px w-56" aria-hidden="true" />
            Loading the scan…
          </>
        )}
      </main>
    );
  }

  return (
    <>
      <ScanBar tree={tree} />

      {stale && (
        <div className="flex shrink-0 justify-center px-4 pt-4">
          <p role="status" className="glass inline-flex max-w-3xl items-center gap-2.5 rounded-nav border border-hairline/20 px-4 py-2 text-ui text-bone">
            <Dot tone="warn" size={7} pulse />
            <span>
              <span className="text-white">Reconnecting.</span> Lost contact with the Worker; showing the last update and retrying every 2 seconds.
            </span>
          </p>
        </div>
      )}

      {view === "results" ? (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-5 sm:px-6 sm:pb-8">
          <div className="mx-auto w-full max-w-300">
            <RootPanel tree={tree} report={report} onSelect={onSelectNode} />
          </div>
        </main>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-5 sm:px-6 sm:pb-6 lg:flex-row lg:overflow-hidden">
          <section
            aria-label="Scan tree"
            className="relative h-105 shrink-0 overflow-hidden rounded-card border border-hairline/10 lg:h-auto lg:min-w-0 lg:flex-1"
          >
            <ScanGraph nodes={graph.nodes} edges={graph.edges} />
          </section>
          <aside aria-label="Details" className="pane shrink-0 lg:w-115 lg:overflow-y-auto lg:pr-1">
            <SidePanel tree={tree} report={report} node={node} onSelect={onSelectNode} onOpenRun={onOpenRun} />
          </aside>
        </div>
      )}
    </>
  );
}
