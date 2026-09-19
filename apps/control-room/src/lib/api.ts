import type {
  CreateScanResponse,
  OrchestratorHealth,
  ReportResponse,
  RunSnapshot,
  ScanListResponse,
  ScanReportResponse,
  ScanTreeResponse,
} from "@friction/shared";
import { ORCHESTRATOR_URL, WORKER_URL } from "./config";

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

/**
 * The UI starts scans only. The orchestrator's POST /runs and POST
 * /suggest-tasks remain for scripts (smoke-local.ts); nothing here calls them.
 */
export const api = {
  /** Starts the crawl, task generation and every persona run in the background; answers with the scan id at once. */
  startScan: (url: string) => request<CreateScanResponse>(`${ORCHESTRATOR_URL}/scans`, json({ url }), 12_000),

  orchestratorHealth: () => request<OrchestratorHealth>(`${ORCHESTRATOR_URL}/health`, undefined, 2500),

  listScans: () => request<ScanListResponse>(`${WORKER_URL}/api/scans?limit=12`, undefined, 5000),
  getScanTree: (scanId: string) => request<ScanTreeResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}`, undefined, 6000),
  getScanReport: (scanId: string) =>
    request<ScanReportResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}/report`, undefined, 8000),

  getSnapshot: (runId: string) => request<RunSnapshot>(`${WORKER_URL}/api/runs/${encodeURIComponent(runId)}`, undefined, 6000),
  getReport: (runId: string) => request<ReportResponse>(`${WORKER_URL}/api/runs/${encodeURIComponent(runId)}/report`, undefined, 6000),

  streamUrl(runId: string, after: string): string {
    const base = `${WORKER_URL}/api/runs/${encodeURIComponent(runId)}/stream`;
    return after ? `${base}?after=${encodeURIComponent(after)}` : base;
  },

  /** Keys are built from [A-Za-z0-9._/-] only, so they are already URL-safe. */
  evidenceUrl: (key: string): string => `${WORKER_URL}/api/evidence/${key}`,
};
