/**
 * The orchestrator's only way to talk to the data plane. Everything is
 * best-effort with retries: a Worker hiccup must never crash a persona.
 */
import type { CreateRunResponse, PersonaPatch, RunEvent } from "@friction/shared";
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
  async createRun(url: string, task: string): Promise<string> {
    const response = await retry(3, 300, () => this.request("/api/runs", this.json("POST", { url, task }), 8000));
    return ((await response.json()) as CreateRunResponse).runId;
  }

  async patchPersona(runId: string, patch: PersonaPatch): Promise<void> {
    try {
      await retry(3, 300, () => this.request(`/api/runs/${runId}/personas`, this.json("PATCH", patch), 8000));
    } catch (err) {
      log("worker", `PATCH persona ${patch.personaId} failed: ${errorMessage(err)}`);
    }
  }

  /** Re-posting is safe: the Worker de-duplicates on (run, persona, seq). */
  async postEvents(runId: string, events: RunEvent[]): Promise<boolean> {
    try {
      await retry(4, 250, () => this.request(`/api/runs/${runId}/events`, this.json("POST", events), 8000));
      return true;
    } catch (err) {
      log("worker", `POST ${events.length} event(s) failed, dropped: ${errorMessage(err)}`);
      return false;
    }
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
