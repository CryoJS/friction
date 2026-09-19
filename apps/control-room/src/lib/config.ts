const trimSlash = (value: string): string => value.replace(/\/+$/, "");

/** Cloudflare Worker: runs, events, SSE, report, evidence. */
export const WORKER_URL = trimSlash(import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787");

/** Node orchestrator: starts scans. Replays, reports and past scans work without it. */
export const ORCHESTRATOR_URL = trimSlash(import.meta.env.VITE_ORCHESTRATOR_URL ?? "http://localhost:8788");

/** Hard cap on steps per agent run; mirrors the orchestrator. Used for progress bars only. */
export const MAX_STEPS = 15;
