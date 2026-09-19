export interface Env {
  /** D1: runs, personas, events, findings. */
  DB: D1Database;
  /** R2: evidence screenshots. */
  EVIDENCE: R2Bucket;
}

export type AppEnv = { Bindings: Env };
