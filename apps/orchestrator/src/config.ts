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
import { DEFAULT_VERIFY_MAX_RUNS, DEFAULT_VERIFY_TOP_N, matchAllowedRepo, parseRepoSlug } from "@friction/shared";
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
  /** GITHUB_API_URL, for GitHub Enterprise Server. Absent: api.github.com. */
  apiUrl?: string | null;
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
  /** Cap on one run's verifications, first attempts and retries together (each is a full browser run). */
  verifyMaxRuns: number;
  /**
   * The repository verified fixes are mapped to and PRs opened against, via a
   * personal access token. Null unless GITHUB_TOKEN, GITHUB_OWNER and
   * GITHUB_REPO are all set; fixes then stay verified-but-unmapped.
   */
  github: GitHubConfig | null;
  /**
   * Every repository a scan may be started with, as "owner/name":
   * GITHUB_OWNER/GITHUB_REPO first, then GITHUB_ALLOWED_REPOS. This process has
   * no auth, so a scan chooses from this list and never names a repository
   * freely. In mock mode with none configured it holds MOCK_REPO, so the whole
   * feature can be shown with no keys.
   */
  /** Never leaves this process: not in /health, not in a log line. */
  githubToken: string | null;
  githubBaseBranch: string | null;
  githubApiUrl: string | null;
  allowedRepos: string[];
  /** Pull requests are previewed, never pushed: GITHUB_DRY_RUN, mock mode, or no GITHUB_TOKEN. */
  githubDryRun: boolean;
  /** Mock mode plays the golden run this many times faster than it was recorded. */
  mockSpeed: number;
}

function githubConfig(): GitHubConfig | null {
  const token = text("GITHUB_TOKEN");
  const owner = text("GITHUB_OWNER");
  const repo = text("GITHUB_REPO");
  if (!token || !owner || !repo) return null;
  return { token, owner, repo, baseBranch: text("GITHUB_BASE_BRANCH"), apiUrl: text("GITHUB_API_URL") };
}

/** Stands in for a connected repository in mock mode. Canned: it does not exist, and mock mode never writes. */
export const MOCK_REPO = "friction-demo/demo-shop";

function allowedRepos(mock: boolean): string[] {
  const owner = text("GITHUB_OWNER");
  const repo = text("GITHUB_REPO");
  const listed = (text("GITHUB_ALLOWED_REPOS") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const repos: string[] = [];
  for (const slug of [...(owner && repo ? [`${owner}/${repo}`] : []), ...listed]) {
    if (!parseRepoSlug(slug)) console.warn(`[config] ignoring ${JSON.stringify(slug)}: a repository is written owner/name`);
    else if (!matchAllowedRepo(repos, slug)) repos.push(slug);
  }
  return repos.length === 0 && mock ? [MOCK_REPO] : repos;
}

/**
 * The single-repo shape pr.ts and repo.ts work with, for a repository on the
 * allow-list. Null when the slug is not allowed, or there is no token to act
 * with (a dry run then has nothing to read either).
 */
export function githubFor(config: Config, slug: string | null | undefined): GitHubConfig | null {
  const allowed = matchAllowedRepo(config.allowedRepos, slug);
  const parsed = parseRepoSlug(allowed);
  if (!parsed || !config.githubToken) return null;
  return { token: config.githubToken, owner: parsed.owner, repo: parsed.repo, baseBranch: config.githubBaseBranch, apiUrl: config.githubApiUrl };
}

function load(): Config {
  const browserEnv: BrowserEnv = (text("BROWSER_ENV") ?? "").toUpperCase() === "LOCAL" ? "LOCAL" : "BROWSERBASE";
  const required = ["OPENAI_API_KEY", "OPENAI_MODEL"];
  if (browserEnv === "BROWSERBASE") required.push("BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID");
  const missingEnv = required.filter((name) => text(name) === null);

  const detail = text("OPENAI_IMAGE_DETAIL");
  const mode = flag("FRICTION_MOCK") || missingEnv.length > 0 ? "mock" : "live";
  return {
    port: int("PORT", 8788, 1, 65535),
    workerUrl: (text("WORKER_URL") ?? "http://127.0.0.1:8787").replace(/\/+$/, ""),
    mode,
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
    maxSessions: int("MAX_SESSIONS", int("PERSONA_CONCURRENCY", 5, 1, 100), 1, 100),
    agentTimeoutMs: int("AGENT_TIMEOUT_MS", 300_000, 30_000, 900_000),
    verifyTopN: int("VERIFY_TOP_N", DEFAULT_VERIFY_TOP_N, 0, 5),
    verifyMaxRuns: int("VERIFY_MAX_RUNS", DEFAULT_VERIFY_MAX_RUNS, 1, 10),
    github: githubConfig(),
    githubToken: text("GITHUB_TOKEN"),
    githubBaseBranch: text("GITHUB_BASE_BRANCH"),
    githubApiUrl: text("GITHUB_API_URL"),
    allowedRepos: allowedRepos(mode === "mock"),
    githubDryRun: flag("GITHUB_DRY_RUN") || mode === "mock" || text("GITHUB_TOKEN") === null,
    mockSpeed: int("MOCK_SPEED", 3, 1, 50),
  };
}

export const config: Config = load();

/** Viewport every session uses. Step bboxes are relative to it. */
export const VIEWPORT = { w: 1280, h: 720 } as const;
