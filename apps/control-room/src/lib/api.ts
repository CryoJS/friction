import type {
  AnnotationsResponse,
  CreateScanResponse,
  FixListResponse,
  GitHubConnectionStatus,
  OpenPullRequestResponse,
  LiveViewResponse,
  OrchestratorHealth,
  ReportResponse,
  RunSnapshot,
  ScanListResponse,
  ScanReportResponse,
  ScanTreeResponse,
} from "@friction/shared";
import { getDemoAnnotations, getDemoFixes, getDemoRunReport, getDemoScanReport, getDemoSnapshot, getDemoTree, isDemoRunId, isDemoScanId } from "./demo";
import { DEMO_MODE, ORCHESTRATOR_URL, WORKER_URL } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page */
    }
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${response.status}`;
      throw new ApiError(message, response.status);
    }
    return body as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const aborted = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(aborted ? "request timed out" : "network unreachable", null);
  } finally {
    window.clearTimeout(timer);
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const patchJson = (body: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * The UI starts scans only. The orchestrator's POST /runs and POST
 * /suggest-tasks remain for scripts (smoke-local.ts); nothing here calls them.
 */
export const api = {
  /**
   * Starts the crawl, task generation and every task's run in the background; answers with the scan id at once.
   * `repo` is one of /health's repositories; with `autoPr` the scan opens one draft pull request per fixable task.
   */
  startScan: (url: string, options: { repo?: string; autoPr?: boolean; taskCount?: number } = {}) =>
    request<CreateScanResponse>(`${ORCHESTRATOR_URL}/scans`, json({ url, ...options }), 12_000),

  /** Cooperatively stops an active scan and leaves its partial results available. */
  stopScan: async (scanId: string): Promise<{ scanId: string }> => {
    const encoded = encodeURIComponent(scanId);
    try {
      return await request<{ scanId: string }>(`${ORCHESTRATOR_URL}/scans/${encoded}/stop`, json({}), 12_000);
    } catch (err) {
      // The orchestrator's active-scan registry is intentionally in memory. If
      // it restarted while this scan was running, stop it at the Worker too.
      if (!(err instanceof ApiError) || (err.status !== null && err.status !== 404 && err.status !== 409 && err.status !== 502 && err.status !== 503)) throw err;
      const scan = await request<{ id: string; status: string }>(`${WORKER_URL}/api/scans/${encoded}`, patchJson({ status: "cancelled", message: "Stopped by user." }), 12_000);
      if (scan.status !== "cancelled") throw new ApiError("This scan is no longer running.", 409);
      return { scanId: scan.id };
    }
  },

  /** The user's click on one fix. Opens it as a draft; a fix its task's pull request already covers answers with that one. */
  openPullRequest: (runId: string, findingId: string) =>
    request<OpenPullRequestResponse>(
      `${ORCHESTRATOR_URL}/runs/${encodeURIComponent(runId)}/fixes/${encodeURIComponent(findingId)}/pull-request`,
      json({}),
      60_000,
    ),

  /**
   * Minted on demand, never stored: the URL is signed, pinned to one page
   * target and only valid while that session is open. Nulls mean the run has
   * no session open right now, and the live view should come down.
   */
  liveView: (runId: string) => request<LiveViewResponse>(`${ORCHESTRATOR_URL}/runs/${encodeURIComponent(runId)}/live-view`, undefined, 6000),

  orchestratorHealth: () => request<OrchestratorHealth>(`${ORCHESTRATOR_URL}/health`, undefined, 2500),

  /** GitHub connected with a button. Names only come back: the token stays in the orchestrator. Managing it only works from the orchestrator's own machine. */
  github: () => request<GitHubConnectionStatus>(`${ORCHESTRATOR_URL}/github`, undefined, 4000),
  githubConnect: () => request<GitHubConnectionStatus>(`${ORCHESTRATOR_URL}/github/connect`, json({}), 20_000),
  githubSetAllowed: (repos: string[]) => request<GitHubConnectionStatus>(`${ORCHESTRATOR_URL}/github/allowed`, json({ repos }), 30_000),
  githubDisconnect: () => request<GitHubConnectionStatus>(`${ORCHESTRATOR_URL}/github/disconnect`, json({}), 8000),

  listScans: () => DEMO_MODE ? Promise.resolve<ScanListResponse>({ scans: [] }) : request<ScanListResponse>(`${WORKER_URL}/api/scans?limit=12`, undefined, 5000),
  getScanTree: (scanId: string) => DEMO_MODE && isDemoScanId(scanId) ? Promise.resolve(getDemoTree(scanId)) : request<ScanTreeResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}`, undefined, 6000),
  getScanReport: (scanId: string) =>
    DEMO_MODE && isDemoScanId(scanId) ? Promise.resolve(getDemoScanReport(scanId)) : request<ScanReportResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}/report`, undefined, 8000),

  /** This scan's own findings, in the overlay's flattened shape -- what the offline bookmarklet can inline. `token` is the scan id, per GET /api/annotations's host-or-token contract. */
  getAnnotations: (scanId: string) =>
    DEMO_MODE && isDemoScanId(scanId) ? Promise.resolve(getDemoAnnotations(scanId)) : request<AnnotationsResponse>(`${WORKER_URL}/api/annotations?token=${encodeURIComponent(scanId)}`, undefined, 8000),

  /** Every fix of one run, newest state per finding: what the issue cards show as the proposed fix. */
  getFixes: (runId: string) => DEMO_MODE && isDemoRunId(runId) ? Promise.resolve(getDemoFixes(runId)) : request<FixListResponse>(`${WORKER_URL}/api/runs/${encodeURIComponent(runId)}/fixes`, undefined, 6000),

  getSnapshot: (runId: string) => DEMO_MODE && isDemoRunId(runId) ? Promise.resolve(getDemoSnapshot(runId)) : request<RunSnapshot>(`${WORKER_URL}/api/runs/${encodeURIComponent(runId)}`, undefined, 6000),
  getReport: (runId: string) => DEMO_MODE && isDemoRunId(runId) ? Promise.resolve(getDemoRunReport(runId)) : request<ReportResponse>(`${WORKER_URL}/api/runs/${encodeURIComponent(runId)}/report`, undefined, 6000),

  streamUrl(runId: string, after: string): string {
    const base = `${WORKER_URL}/api/runs/${encodeURIComponent(runId)}/stream`;
    return after ? `${base}?after=${encodeURIComponent(after)}` : base;
  },

  /** Keys are built from [A-Za-z0-9._/-] only, so they are already URL-safe. */
  evidenceUrl: (key: string): string => `${WORKER_URL}/api/evidence/${key}`,
};
