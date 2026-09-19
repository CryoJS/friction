import { useCallback, useEffect, useState } from "react";

export type Tab = "scan" | "results";

export interface Query {
  run: string | null;
  scan: string | null;
  /** Selected node on the scan canvas ("t2", "t2.keyboard"); null means the site root. */
  node: string | null;
  replay: boolean;
  tab: Tab;
}

function read(): Query {
  const params = new URLSearchParams(window.location.search);
  return {
    run: params.get("run") || null,
    scan: params.get("scan") || null,
    node: params.get("node") || null,
    replay: params.get("replay") === "1",
    tab: params.get("tab") === "results" ? "results" : "scan",
  };
}

/** A scan wins over a run: ?scan= never carries run parameters, and ?run= never carries a node. */
function write(query: Query): string {
  const params = new URLSearchParams();
  if (query.scan) {
    params.set("scan", query.scan);
    if (query.node && query.node !== "root") params.set("node", query.node);
    if (query.tab === "results") params.set("tab", "results");
  } else if (query.run) {
    params.set("run", query.run);
    if (query.replay) params.set("replay", "1");
  }
  const search = params.toString();
  return search ? `?${search}` : window.location.pathname;
}

/**
 * The URL is the app state: ?scan=<id>[&node=<id>][&tab=results] for a scan, or
 * ?run=<id>[&replay=1] for a single run. That keeps every view
 * linkable (handy when the demo laptop needs a specific view, fast) and makes
 * the back button behave.
 */
export function useQuery(): [Query, (patch: Partial<Query>) => void] {
  const [query, setQuery] = useState<Query>(read);

  useEffect(() => {
    const onPop = (): void => setQuery(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = useCallback((patch: Partial<Query>) => {
    const next = { ...read(), ...patch };
    window.history.pushState(null, "", write(next));
    setQuery(next);
  }, []);

  return [query, update];
}
