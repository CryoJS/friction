const trimSlash = (value: string): string => value.replace(/\/+$/, "");

/** Cloudflare Worker: runs, events, SSE, report, evidence. */
export const WORKER_URL = trimSlash(import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787");

/** Node orchestrator: starts runs and suggests tasks. The UI works without it. */
export const ORCHESTRATOR_URL = trimSlash(import.meta.env.VITE_ORCHESTRATOR_URL ?? "http://localhost:8788");

/** Hard cap on steps per persona; mirrors the orchestrator. Used for progress bars only. */
export const MAX_STEPS = 15;
