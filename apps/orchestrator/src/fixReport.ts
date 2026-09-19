/**
 * The orchestrator's handle on one fix. It holds the fix's complete state and
 * posts all of it to the Worker on every change, so each fix event is a full
 * picture of the fix and a late viewer never has to stitch stages together.
 */
import type { FixEvent, FixPayload, FixUpsert } from "@friction/shared";
import { log } from "./util";
import type { WorkerClient } from "./workerClient";

export class FixReport {
  private current: FixPayload;
  /** The seq of the last fix event the Worker stored for this fix (0 until one is). */
  lastSeq = 0;

  constructor(
    private readonly worker: WorkerClient,
    readonly runId: string,
    initial: FixPayload,
  ) {
    this.current = initial;
  }

  get state(): Readonly<FixPayload> {
    return this.current;
  }

  get findingId(): string {
    return this.current.findingId;
  }

  /**
   * Merges `patch` and posts the whole fix. newFileContent (and the sha it was
   * generated from) travel only with the update that sets them; the Worker
   * keeps them after that.
   */
  async update(patch: Partial<FixPayload> & Pick<FixUpsert, "newFileContent" | "sourceSha">): Promise<FixEvent | null> {
    const { newFileContent, sourceSha, ...changes } = patch;
    this.current = { ...this.current, ...changes };
    const body: FixUpsert = newFileContent === undefined ? this.current : { ...this.current, newFileContent, sourceSha: sourceSha ?? null };
    const stored = await this.worker.postFix(this.runId, body);
    if (stored) this.lastSeq = stored.event.seq;
    log("fix", `${this.findingId} -> ${this.current.stage}${this.current.note ? ` (${this.current.note})` : ""}`);
    return stored?.event ?? null;
  }
}
