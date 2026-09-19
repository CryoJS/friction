import { useEffect, useState } from "react";
import type { ScanReportResponse } from "@friction/shared";
import { api } from "../lib/api";

/**
 * The merged site report. Refetched whenever `refreshKey` changes (the scan
 * page derives it from findings, finished runs, task count and status). A
 * failed fetch keeps the last report on screen.
 */
export function useScanReport(scanId: string, refreshKey: string): { report: ScanReportResponse | null; loading: boolean } {
  const [report, setReport] = useState<ScanReportResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setReport(null);
  }, [scanId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getScanReport(scanId)
      .then((body) => {
        if (!cancelled) setReport(body);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId, refreshKey]);

  return { report, loading };
}
