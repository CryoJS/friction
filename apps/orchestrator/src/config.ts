/**
 * Environment. Read once at startup.
 *
 * The orchestrator has two modes:
 *   live  real Browserbase sessions driven by OpenAI.
 *   mock  no keys needed: the golden run is replayed through the REAL pipeline
 *         (Worker, D1, R2, SSE, detectors). Chosen automatically while any
 *         required variable is missing, so the repo runs end to end before a
 *         single API key exists. Force it with FRICTION_MOCK=1.
 *
 * The OpenAI model is ONLY ever read from OPENAI_MODEL. There is no default
 * and no model name anywhere in this codebase.
 */
import { existsSync } from "node:fs";
import { DEFAULT_VERIFY_TOP_N } from "@friction/shared";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");

// apps/orchestrator/.env wins over the repo-root .env; real environment variables win over both.
for (const file of [resolve(appDir, ".env"), resolve(repoRoot, ".env")]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const text = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value ? value : null;
};
const int = (name: string, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(text(name) ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const flag = (name: string): boolean => ["1", "true", "yes"].includes((text(name) ?? "").toLowerCase());

/** The spec's hard cap. MAX_STEPS can lower it, never raise it. */
export const HARD_STEP_CAP = 15;

export type BrowserEnv = "BROWSERBASE" | "LOCAL";

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  /** Null: use the repository's default branch. */
  baseBranch: string | null;
}

export interface Config {
  port: number;
  workerUrl: string;
  mode: "live" | "mock";
  missingEnv: string[];
  browserEnv: BrowserEnv;
  openaiApiKey: string | null;
  openaiModel: string | null;
  /** Model for Stagehand's own observe() calls. Defaults to OPENAI_MODEL. */
  stagehandModel: string | null;
  reasoningEffort: string | null;
  imageDetail: "low" | "high" | "auto";
  browserbaseApiKey: string | null;
  browserbaseProjectId: string | null;
  browserbaseRegion: string | null;
  localBrowserPath: string | null;
  maxSteps: number;
  /**
   * Browser sessions open at once, across every run and scan: primary runs,
   * fix verifications and scan crawls all take one. Browserbase plans cap concurrency.
   */
  maxSessions: number;
  /** Wall-clock budget for one agent run (primary or verify). */
  agentTimeoutMs: number;
  /** How many of a run's findings get a fix proposed and verified (each costs a full browser run). */
  verifyTopN: number;
  /**
   * The repository verified fixes are mapped to and PRs opened against, via a
   * personal access token. Null unless GITHUB_TOKEN, GITHUB_OWNER and
   * GITHUB_REPO are all set; fixes then stay verified-but-unmapped.
   */
  github: GitHubConfig | null;
  /** Mock mode plays the golden run this many times faster than it was recorded. */
  mockSpeed: number;
}

function githubConfig(): GitHubConfig | null {
  const token = text("GITHUB_TOKEN");
  const owner = text("GITHUB_OWNER");
  const repo = text("GITHUB_REPO");
  if (!token || !owner || !repo) return null;
  return { token, owner, repo, baseBranch: text("GITHUB_BASE_BRANCH") };
}

function load(): Config {
  const browserEnv: BrowserEnv = (text("BROWSER_ENV") ?? "").toUpperCase() === "LOCAL" ? "LOCAL" : "BROWSERBASE";
  const required = ["OPENAI_API_KEY", "OPENAI_MODEL"];
  if (browserEnv === "BROWSERBASE") required.push("BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID");
  const missingEnv = required.filter((name) => text(name) === null);

  const detail = text("OPENAI_IMAGE_DETAIL");
  return {
    port: int("PORT", 8788, 1, 65535),
    workerUrl: (text("WORKER_URL") ?? "http://127.0.0.1:8787").replace(/\/+$/, ""),
    mode: flag("FRICTION_MOCK") || missingEnv.length > 0 ? "mock" : "live",
    missingEnv,
    browserEnv,
    openaiApiKey: text("OPENAI_API_KEY"),
    openaiModel: text("OPENAI_MODEL"),
    stagehandModel: text("STAGEHAND_MODEL") ?? text("OPENAI_MODEL"),
    reasoningEffort: text("OPENAI_REASONING_EFFORT"),
    imageDetail: detail === "low" || detail === "auto" ? detail : "high",
    browserbaseApiKey: text("BROWSERBASE_API_KEY"),
    browserbaseProjectId: text("BROWSERBASE_PROJECT_ID"),
    browserbaseRegion: text("BROWSERBASE_REGION"),
    localBrowserPath: text("LOCAL_BROWSER_PATH"),
    maxSteps: int("MAX_STEPS", HARD_STEP_CAP, 1, HARD_STEP_CAP),
    // PERSONA_CONCURRENCY is the old name, still honoured so existing .env files keep working.
    maxSessions: int("MAX_SESSIONS", int("PERSONA_CONCURRENCY", 3, 1, 100), 1, 100),
    agentTimeoutMs: int("AGENT_TIMEOUT_MS", 300_000, 30_000, 900_000),
    verifyTopN: int("VERIFY_TOP_N", DEFAULT_VERIFY_TOP_N, 0, 5),
    github: githubConfig(),
    mockSpeed: int("MOCK_SPEED", 3, 1, 50),
  };
}

export const config: Config = load();

/** Viewport every session uses. Step bboxes are relative to it. */
export const VIEWPORT = { w: 1280, h: 720 } as const;
