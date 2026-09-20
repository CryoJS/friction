import { useCallback, useEffect, useState } from "react";

export type Tab = "scan" | "results";

export interface Query {
  scan: string | null;
  /** Selected node on the scan canvas ("t2", "t2.keyboard"); null means the site root. */
  node: string | null;
  tab: Tab;
}

function read(): Query {
  const params = new URLSearchParams(window.location.search);
  return {
    scan: params.get("scan") || null,
    node: params.get("node") || null,
    tab: params.get("tab") === "results" ? "results" : "scan",
  };
}

/** The URL only represents the scan canvas and its selected node. */
function write(query: Query): string {
  const params = new URLSearchParams();
  if (query.scan) {
    params.set("scan", query.scan);
    if (query.node && query.node !== "root") params.set("node", query.node);
    if (query.tab === "results") params.set("tab", "results");
  }
  const search = params.toString();
  return search ? `?${search}` : window.location.pathname;
}

/**
 * The URL is the app state: ?scan=<id>[&node=<id>][&tab=results]. That keeps
 * every scan view linkable and makes the back button behave.
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
