import { useCallback, useEffect, useState } from "react";

export type Tab = "room" | "report";

export interface Query {
  run: string | null;
  replay: boolean;
  tab: Tab;
}

function read(): Query {
  const params = new URLSearchParams(window.location.search);
  return {
    run: params.get("run") || null,
    replay: params.get("replay") === "1",
    tab: params.get("tab") === "report" ? "report" : "room",
  };
}

function write(query: Query): string {
  const params = new URLSearchParams();
  if (query.run) params.set("run", query.run);
  if (query.run && query.replay) params.set("replay", "1");
  if (query.run && query.tab === "report") params.set("tab", "report");
  const search = params.toString();
  return search ? `?${search}` : window.location.pathname;
}

/**
 * The URL is the app state: ?run=<id>[&replay=1][&tab=report]. That keeps every
 * view linkable (handy when the demo laptop needs a specific run, fast) and
 * makes the back button behave.
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
