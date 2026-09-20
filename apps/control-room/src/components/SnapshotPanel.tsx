import { useEffect, useState } from "react";
import { issuePath, type AnnotationFinding } from "@friction/shared";
import { api } from "../lib/api";
import { SnapshotViewer } from "./SnapshotViewer";

interface PageGroup {
  /** The scanned page. One entry per page, not per snapshot. */
  url: string;
  /** The snapshot used as the canvas: the latest one captured of this page. */
  canvas: string;
  findings: AnnotationFinding[];
}

/**
 * Step number, read back out of the snapshot's R2 key
 * ("runs/<runId>/primary/0007.html"). The annotations contract does not carry
 * the evidence step's seq, and this key is the only ordering signal available.
 */
function seqOf(snapshotUrl: string): number {
  const match = /\/(\d+)\.html$/.exec(snapshotUrl);
  return match?.[1] ? Number(match[1]) : 0;
}

/**
 * Every page of the site, annotated — one view per page, not one per snapshot.
 *
 * A snapshot is captured each time a step evidences a finding, so a single page
 * routinely has a dozen of them. Navigating those directly exposes an
 * implementation detail nobody thinks in. Instead each page gets ONE canvas and
 * every finding for that page is drawn on it at once.
 *
 * The canvas is the LATEST snapshot of the page, not the earliest: it is
 * furthest into the task, so anything the agent caused to appear (an opened
 * cart, an error message) is present, while elements that were there all along
 * still resolve. Where a finding was recorded against a state this canvas no
 * longer matches, resolveAnchor degrades it to an unlocated row in the
 * overlay's own panel rather than pinning it somewhere wrong — which is exactly
 * what that ladder exists for.
 */
export function SnapshotPanel({ scanId, refreshKey, focusedFindingId = null, focusedPath = null }: { scanId: string; refreshKey?: string; focusedFindingId?: string | null; focusedPath?: string | null }): React.ReactElement {
  const [groups, setGroups] = useState<PageGroup[] | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
  }, [scanId]);

  useEffect(() => {
    if (!groups) return;
    const index = focusedFindingId
      ? groups.findIndex((group) => group.findings.some((finding) => finding.findingId === focusedFindingId))
      : focusedPath
        ? groups.findIndex((group) => (issuePath(group.url) || "/") === annotationPathKey(focusedPath))
        : -1;
    if (index >= 0) setActive(index);
  }, [focusedFindingId, focusedPath, groups]);

  useEffect(() => {
    let cancelled = false;
    // Only blank the pane for a genuinely different scan; a refresh mid-run must
    // not throw away what is already on screen.
    setGroups((previous) => (previous && previous.length > 0 ? previous : null));
    api
      .getAnnotations(scanId)
      .then((response) => {
        if (cancelled) return;
        const byPage = new Map<string, PageGroup>();
        for (const finding of response.findings) {
          if (!finding.snapshotUrl) continue;
          const group = byPage.get(finding.url) ?? { url: finding.url, canvas: finding.snapshotUrl, findings: [] };
          group.findings.push(finding);
          if (seqOf(finding.snapshotUrl) > seqOf(group.canvas)) group.canvas = finding.snapshotUrl;
          byPage.set(finding.url, group);
        }
        setGroups([...byPage.values()].sort((a, b) => b.findings.length - a.findings.length));
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId, refreshKey]);

  if (!groups) {
    return <p className="px-4 py-6 text-ui text-smoke">Loading the annotated pages…</p>;
  }

  // No snapshots is not an error: scans recorded before snapshots existed have none.
  if (groups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-body text-bone">No page snapshots for this scan.</p>
        <p className="text-ui text-smoke">Scans run before snapshots existed have none. Re-run the scan to capture them.</p>
      </div>
    );
  }

  const current = groups[Math.min(active, groups.length - 1)];
  if (!current) return <div />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <SnapshotViewer key={current.canvas} snapshotUrl={current.canvas} findings={current.findings} scanId={scanId} focusedFindingId={focusedFindingId} />
      </div>
    </div>
  );
}

function annotationPathKey(path: string): string {
  return path.startsWith("panel:") ? path.slice("panel:".length).split(":")[0] || "/" : path;
}
