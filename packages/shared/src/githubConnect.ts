/**
 * Connecting GitHub with a button: the pure half of GitHub's device flow.
 *
 * The orchestrator asks GitHub for a short code, a person approves it at
 * github.com/login/device, and the orchestrator's poll is answered with a
 * token. No callback URL and no secret, so it works on localhost. What GitHub's
 * answers mean, which repositories a token may push to, and what the control
 * room is told live here; the network and the token itself never do.
 */
import { parseRepoSlug } from "./scanPr";

/* ------------------------------------------------------------- device flow */

/** POST /login/device/code, as GitHub answers it. */
export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the code is worthless. */
  expiresIn: number;
  /** Seconds GitHub wants between polls. */
  interval: number;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback);

/** Null when the answer is not a device code (a wrong client id answers 200 with an `error`). */
export function parseDeviceCode(body: unknown): DeviceCode | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const deviceCode = str(b.device_code);
  const userCode = str(b.user_code);
  const verificationUri = str(b.verification_uri);
  // Only ever a github.com page: this URL is shown to a person as the place to type a code.
  if (!deviceCode || !userCode || !/^https:\/\/github\.com\//.test(verificationUri)) return null;
  return { deviceCode, userCode, verificationUri, expiresIn: num(b.expires_in, 900), interval: num(b.interval, 5) };
}

export type DeviceTokenAnswer =
  | { kind: "granted"; token: string }
  /** Nobody has typed the code yet. Poll again. */
  | { kind: "pending" }
  /** Polling too fast: GitHub's new interval, in seconds. */
  | { kind: "slow_down"; interval: number }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

/**
 * What one poll of POST /login/oauth/access_token means. GitHub answers every
 * case with HTTP 200 and says which in an `error` field, so this is the whole
 * state machine's branching.
 */
export function interpretDeviceToken(body: unknown, currentInterval: number): DeviceTokenAnswer {
  const b = (body ?? {}) as Record<string, unknown>;
  const token = str(b.access_token);
  if (token) return { kind: "granted", token };
  switch (str(b.error)) {
    case "authorization_pending":
      return { kind: "pending" };
    case "slow_down":
      // GitHub adds five seconds each time and says so; fall back to doing the same.
      return { kind: "slow_down", interval: num(b.interval, currentInterval + 5) };
    case "access_denied":
      return { kind: "denied" };
    case "expired_token":
      return { kind: "expired" };
    case "":
      return { kind: "error", message: "GitHub's answer had neither a token nor an error." };
    default:
      return { kind: "error", message: str(b.error_description) || str(b.error) };
  }
}

/* ------------------------------------------------------------ repositories */

/**
 * GET /user/repos -> the "owner/name" slugs this token can open a pull request
 * against: push permission, not archived, not disabled. Sorted, no duplicates.
 */
export function writableRepos(apiRepos: unknown): string[] {
  if (!Array.isArray(apiRepos)) return [];
  const slugs = new Map<string, string>();
  for (const entry of apiRepos) {
    const repo = (entry ?? {}) as { full_name?: unknown; archived?: unknown; disabled?: unknown; permissions?: { push?: unknown } | null };
    if (repo.archived === true || repo.disabled === true || repo.permissions?.push !== true) continue;
    const parsed = parseRepoSlug(str(repo.full_name));
    if (parsed) slugs.set(`${parsed.owner}/${parsed.repo}`.toLowerCase(), `${parsed.owner}/${parsed.repo}`);
  }
  return [...slugs.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

/** The ticked repositories that the token can really write to, in the token's own spelling. Anything else is dropped. */
export function keepWritable(wanted: readonly string[], writable: readonly string[]): string[] {
  const byKey = new Map(writable.map((slug) => [slug.toLowerCase(), slug] as const));
  const kept = new Set<string>();
  for (const slug of wanted) {
    const match = byKey.get(slug.trim().toLowerCase());
    if (match) kept.add(match);
  }
  return [...kept].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

/* ------------------------------------------------------------------ status */

/**
 * GET <orchestrator>/github: what the control room may know. Names only: the
 * token, and the device code that would fetch one, never leave the orchestrator.
 */
export interface GitHubConnectionStatus {
  /** False when GITHUB_CLIENT_ID is not set (or in mock mode): there is nothing to connect with. */
  available: boolean;
  state: "disconnected" | "pending" | "connected";
  /** Where the token in use comes from. "env" = GITHUB_TOKEN, exactly as before this existed. */
  source: "connection" | "env" | "none";
  login?: string;
  /** Pending: the code to type, where to type it, and when it stops working (epoch ms). */
  userCode?: string;
  verificationUri?: string;
  expiresAt?: number;
  /** Connected: every repository the token can write to. */
  repos?: string[];
  /** Repositories a scan may be started with. */
  allowed: string[];
  /** Why the last attempt to connect ended, when it did not end well. */
  error?: string;
}

/* ------------------------------------------------------------------- guard */

/** 127.0.0.0/8, ::1, and their IPv4-mapped IPv6 spelling: a socket from this machine. */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  const a = (address ?? "").trim().toLowerCase().replace(/^::ffff:/, "");
  return a === "::1" || /^127(\.\d{1,3}){3}$/.test(a);
}

/**
 * May this request manage the GitHub connection (connect, tick repositories,
 * disconnect)? The orchestrator has no login, so the answer is "only from this
 * machine": the socket is loopback, and a browser's Origin, when there is one,
 * is a localhost page. Deliberately narrower than the CORS policy, which also
 * admits *.pages.dev: ANY Pages site open in a browser here could otherwise
 * widen the tick-list to every repository the token can write to. A request
 * with no Origin (curl, a script) is not a browser and is judged by its socket.
 */
export function mayManageConnection(request: { remoteAddress: string | null | undefined; origin: string | null | undefined }): boolean {
  if (!isLoopbackAddress(request.remoteAddress)) return false;
  if (request.origin === undefined || request.origin === null || request.origin === "") return true;
  try {
    const url = new URL(request.origin);
    return (url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "localhost" || url.hostname === "[::1]" || isLoopbackAddress(url.hostname));
  } catch {
    return false;
  }
}
