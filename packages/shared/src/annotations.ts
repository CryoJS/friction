/**
 * GET /api/annotations: what the bookmarklet overlay is served.
 *
 * Pure, like report.ts and scanReport.ts. The Worker does the D1 reads and
 * calls these; everything decidable without a database is tested here.
 *
 * This flattens what assembleScanReport already works from. It is a second
 * SHAPE of the findings, never a second source of truth for them.
 */
import { normalizeHost, type Anchor } from "./anchor";
import type { FrictionCategory, Severity, StepEvent } from "./events";
import type { ScanFindingInput } from "./scanReport";

/** One deduplicated finding, flattened for the overlay. */
export interface AnnotationFinding {
  findingId: string;
  category: FrictionCategory;
  severity: Severity;
  summary: string;
  whyItMatters: string;
  recommendation: string;
  /** The page the finding happened on. Groups the panel. "" when unknown. */
  url: string;
  /** Null for scans recorded before anchors existed: the overlay lists it as unlocated. */
  anchor: Anchor | null;
  /** Absolute URL of the evidence screenshot, or null when none was captured. */
  evidenceUrl: string | null;
  /** The proposed fix. Advisory only: nothing executes it. Null when none was produced. */
  patchJs: string | null;
  /** Absolute URL of the HTML snapshot of this page, for the embedded viewer. Null when none was captured. */
  snapshotUrl: string | null;
  hitCount: number;
}

export interface AnnotationsResponse {
  scanId: string;
  scannedAt: number;
  url: string;
  /** Lets the panel tell the user their bookmarklet is out of date. */
  overlayVersion: number;
  findings: AnnotationFinding[];
}

export type AnnotationsQuery =
  | { ok: true; by: "host" | "token"; value: string }
  | { ok: false; error: string };

/**
 * Exactly one of host or token. Both, neither, or a host that does not
 * normalize is a 400: guessing which the caller meant would silently serve
 * the wrong scan.
 */
export function parseAnnotationsQuery(params: { host?: string | null; token?: string | null }): AnnotationsQuery {
  const host = params.host?.trim() ?? "";
  const token = params.token?.trim() ?? "";
  if (host && token) return { ok: false, error: "give either host or token, not both" };
  if (!host && !token) return { ok: false, error: "host or token is required" };
  if (token) return { ok: true, by: "token", value: token };
  const normalized = normalizeHost(host);
  if (!normalized) return { ok: false, error: `host "${host}" is not a hostname` };
  return { ok: true, by: "host", value: normalized };
}

/**
 * One D1 finding row plus its evidence step, in the overlay's shape. A missing
 * step or a missing anchor is normal (older scans, failed captures), never an
 * error: the finding is still worth listing, it just cannot be pinned.
 */
export function toAnnotationFinding(
  finding: ScanFindingInput,
  step: StepEvent | undefined,
  evidenceBase: string,
  patchJs: string | null = null,
): AnnotationFinding {
  const payload = step?.payload;
  const key = payload?.screenshotKey ?? "";
  const snapKey = payload?.snapshotKey ?? "";
  return {
    findingId: finding.id,
    category: finding.category,
    severity: finding.severity,
    summary: finding.summary ?? "",
    whyItMatters: finding.whyItMatters ?? "",
    recommendation: finding.recommendation,
    url: payload?.url ?? "",
    anchor: payload?.anchor ?? null,
    evidenceUrl: key ? `${evidenceBase.replace(/\/$/, "")}/${key}` : null,
    snapshotUrl: snapKey ? `${evidenceBase.replace(/\/$/, "")}/${snapKey}` : null,
    patchJs,
    hitCount: finding.hitCount,
  };
}
