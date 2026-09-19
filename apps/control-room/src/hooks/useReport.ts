import { useEffect, useState } from "react";
import { buildReportFromSnapshot, type ReportResponse, type RunSnapshot } from "@friction/shared";
import { api } from "../lib/api";

export interface ReportState {
  report: ReportResponse | null;
  loading: boolean;
  /** True when the report was assembled in the browser because the Worker did not answer. */
  local: boolean;
}

/**
 * GET /api/runs/:id/report, refetched whenever `refreshKey` changes (the
 * caller passes the friction count, so new findings show up while a run is
 * live). If the Worker does not answer, the same report is assembled locally
 * from whatever the control room already holds: shared/report.ts is the single
 * implementation behind both.
 */
export function useReport(
  runId: string | null,
  enabled: boolean,
  fallback: RunSnapshot | null,
  options: { localOnly: boolean; refreshKey: number },
): ReportState {
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [local, setLocal] = useState(false);
  const { localOnly, refreshKey } = options;

  useEffect(() => {
    setReport(null);
  }, [runId]);

  useEffect(() => {
    if (!enabled || !runId) return;
    let cancelled = false;

    const buildLocally = (): void => {
      if (cancelled) return;
      setLocal(true);
      setReport(fallback ? buildReportFromSnapshot(fallback) : null);
      setLoading(false);
    };

    if (localOnly) {
      buildLocally();
      return;
    }

    setLoading(true);
    api
      .getReport(runId)
      .then((loaded) => {
        if (cancelled) return;
        setLocal(false);
        setReport(loaded);
        setLoading(false);
      })
      .catch(buildLocally);

    return () => {
      cancelled = true;
    };
    // `fallback` is deliberately not a dependency: it changes on every event,
    // and refreshKey already tells us when the findings changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, enabled, localOnly, refreshKey]);

  return { report, loading, local };
}
