/**
 * The orchestrator's only way to talk to the data plane. Everything is
 * best-effort with retries: a Worker hiccup must never crash a run.
 */
import type {
  CreateRunResponse,
  CreateScanResponse,
  FixListResponse,
  FixRecord,
  FixUpsert,
  PostFixResponse,
  RunEvent,
  RunPatch,
  RunScanLink,
  RunSnapshot,
  ScanPatch,
  ScanTaskLink,
  ScanTreeResponse,
  TaskPullRequest,
} from "@friction/shared";
import { errorMessage, log, retry } from "./util";

export class WorkerClient {
  constructor(private readonly baseUrl: string) {}

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status} ${body.slice(0, 200)}`);
    }
    return response;
  }

  private json(method: string, body: unknown): RequestInit {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }

  /** The one call that is allowed to fail loudly: without a run there is nothing to do. */
  async createRun(url: string, task: string, scan?: ScanTaskLink): Promise<string> {
    const body = scan ? { url, task, scan } : { url, task };
    const response = await retry(3, 300, () => this.request("/api/runs", this.json("POST", body), 8000));
    return ((await response.json()) as CreateRunResponse).runId;
  }

  /** Fails loudly too: no scan, nothing to show. */
  async createScan(url: string, options: { repo?: string; autoPr?: boolean } = {}): Promise<string> {
    const response = await retry(3, 300, () => this.request("/api/scans", this.json("POST", { url, ...options }), 8000));
    return ((await response.json()) as CreateScanResponse).scanId;
  }

  /** Progress and status. Best-effort: a lost progress message must never stop a scan. */
  async patchScan(scanId: string, patch: ScanPatch): Promise<void> {
    try {
      await retry(3, 300, () => this.request(`/api/scans/${scanId}`, this.json("PATCH", patch), 8000));
    } catch (err) {
      log("worker", `PATCH scan ${scanId} failed: ${errorMessage(err)}`);
    }
  }

  /** The primary session's URLs, or the run's lifecycle status. */
  async patchRun(runId: string, patch: RunPatch): Promise<void> {
    try {
      await retry(3, 300, () => this.request(`/api/runs/${runId}`, this.json("PATCH", patch), 8000));
    } catch (err) {
      log("worker", `PATCH run ${runId} failed: ${errorMessage(err)}`);
    }
  }

  /** Re-posting is safe: the Worker de-duplicates on (run, lane, seq). */
  async postEvents(runId: string, events: RunEvent[]): Promise<boolean> {
    try {
      await retry(4, 250, () => this.request(`/api/runs/${runId}/events`, this.json("POST", events), 8000));
      return true;
    } catch (err) {
      log("worker", `POST ${events.length} event(s) failed, dropped: ${errorMessage(err)}`);
      return false;
    }
  }

  /**
   * Upserts a fix and returns the stored fix event (its seq is the Worker's).
   * Null if the Worker could not be reached: the pipeline carries on, the UI
   * just misses that stage.
   */
  async postFix(runId: string, upsert: FixUpsert): Promise<PostFixResponse | null> {
    try {
      const response = await retry(3, 300, () => this.request(`/api/runs/${runId}/fixes`, this.json("POST", upsert), 10_000));
      return (await response.json()) as PostFixResponse;
    } catch (err) {
      log("worker", `POST fix ${upsert.findingId} (${upsert.stage}) failed: ${errorMessage(err)}`);
      return null;
    }
  }

  /** One task's pull request outcome. Best-effort, like every progress report: false when it could not be stored. */
  async upsertTaskPullRequest(pr: TaskPullRequest): Promise<boolean> {
    try {
      await retry(3, 300, () => this.request(`/api/scans/${pr.scanId}/pull-requests`, this.json("POST", pr), 10_000));
      return true;
    } catch (err) {
      log("worker", `POST pull request of task ${pr.taskIndex + 1} (${pr.status}) failed: ${errorMessage(err)}`);
      return false;
    }
  }

  async getScanTree(scanId: string): Promise<ScanTreeResponse> {
    const response = await retry(2, 300, () => this.request(`/api/scans/${scanId}`, {}, 10_000));
    return (await response.json()) as ScanTreeResponse;
  }

  /** The scan a run is a task of, or null for a run started on its own (or a Worker that predates scans' repositories). */
  async getRunScan(runId: string): Promise<RunScanLink | null> {
    const response = await fetch(`${this.baseUrl}/api/runs/${runId}/scan`, { signal: AbortSignal.timeout(8000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET /api/runs/${runId}/scan -> ${response.status}`);
    return (await response.json()) as RunScanLink;
  }

  /** Every fix row of a run, file content included, in the order the run verified them. Throws when unreachable. */
  async getFixes(runId: string): Promise<FixRecord[]> {
    const response = await retry(2, 300, () => this.request(`/api/runs/${runId}/fixes`, {}, 10_000));
    return ((await response.json()) as FixListResponse).fixes;
  }

  /** The stored fix row, file content included. Throws when unreachable: callers must not guess. */
  async getFix(runId: string, findingId: string): Promise<FixRecord | null> {
    const response = await retry(2, 300, () => this.request(`/api/runs/${runId}/fixes`, {}, 8000));
    return ((await response.json()) as FixListResponse).fixes.find((f) => f.findingId === findingId) ?? null;
  }

  async getSnapshot(runId: string): Promise<RunSnapshot> {
    const response = await retry(2, 300, () => this.request(`/api/runs/${runId}`, {}, 10_000));
    return (await response.json()) as RunSnapshot;
  }

  /** Returns false if the upload failed; the step is still reported, just without a screenshot. */
  async putEvidence(key: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
    try {
      // fetch takes a Uint8Array at runtime; newer TS lib types reject the (possibly shared) buffer generic.
      const body = bytes as unknown as BodyInit;
      await retry(3, 300, () => this.request(`/api/evidence/${key}`, { method: "PUT", headers: { "Content-Type": contentType }, body }, 15_000));
      return true;
    } catch (err) {
      log("worker", `PUT evidence ${key} failed: ${errorMessage(err)}`);
      return false;
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.request("/api/health", {}, 2500);
      return true;
    } catch {
      return false;
    }
  }
}
