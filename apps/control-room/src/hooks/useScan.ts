import { useEffect, useState } from "react";
import { isScanFinished, type ScanTreeResponse } from "@friction/shared";
import { ApiError, api } from "../lib/api";

/** How often the tree is polled while the scan is going. */
export const SCAN_POLL_MS = 2000;

export interface ScanPoll {
  tree: ScanTreeResponse | null;
  /** The latest poll failed; `tree` is the last one that worked. Polling continues. */
  stale: boolean;
  /** The Worker says this scan does not exist. Nothing to retry. */
  missing: boolean;
}

/**
 * Polls GET /api/scans/:id every 2s until the scan completes, fails, or is stopped. One
 * small request per poll; the selected task streams its run on its own.
 */
export function useScan(scanId: string): ScanPoll {
  const [state, setState] = useState<ScanPoll>({ tree: null, stale: false, missing: false });

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setState({ tree: null, stale: false, missing: false });

    const poll = async (): Promise<void> => {
      try {
        const tree = await api.getScanTree(scanId);
        if (cancelled) return;
        setState({ tree, stale: false, missing: false });
        if (isScanFinished(tree.scan.status)) return;
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ tree: null, stale: false, missing: true });
          return;
        }
        setState((previous) => ({ ...previous, stale: true }));
      }
      timer = window.setTimeout(() => void poll(), SCAN_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scanId]);

  return state;
}
