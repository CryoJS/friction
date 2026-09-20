import { useEffect, useState } from "react";
import type { FixRecord } from "@friction/shared";
import { api } from "../lib/api";

/**
 * Every fix of one run, by findingId. Fetched once per run, then polled while
 * the run is still verifying, so a fix card follows proposed -> verifying ->
 * verified/rejected live. A failed fetch keeps whatever is on screen.
 */
export function useRunFixes(runId: string | null, verifying: boolean): Map<string, FixRecord> {
  const [fixes, setFixes] = useState<Map<string, FixRecord>>(new Map());

  useEffect(() => {
    setFixes(new Map());
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const load = () =>
      api
        .getFixes(runId)
        .then((body) => {
          if (!cancelled) setFixes(new Map(body.fixes.map((fix) => [fix.findingId, fix])));
        })
        .catch(() => undefined);
    load();
    // Settling flips `verifying`, which re-runs this effect: that re-run is the final load.
    if (!verifying) return () => void (cancelled = true);
    const timer = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runId, verifying]);

  return fixes;
}
