/**
 * Scan pull requests: one draft PR per task. The pure half. Which repository
 * a scan may name, which paths a PR may ever touch, and, from every task's
 * fixes, what each task commits, what another PR already covers and what is
 * found but not fixed. No SDKs, no network, no clock: the orchestrator does
 * the GitHub calls, and the tests hold this to the rules.
 */
import type { FixStage } from "./events";
import { isSourcePath } from "./fixes";
import { REPO_SLUG, TASK_PR_STATUSES, type CoveredBy, type TaskPullRequest, type TaskPullRequestStatus, type TaskPullRequestTotals } from "./scan";

/* ------------------------------------------------------------------- repos */

export interface RepoSlug {
  owner: string;
  repo: string;
}

/** "owner/name" -> its parts, or null. Dot-only names ("..", ".") are never a repository. */
export function parseRepoSlug(input: string | null | undefined): RepoSlug | null {
  const slug = (input ?? "").trim();
  if (!REPO_SLUG.test(slug)) return null;
  const [owner = "", repo = ""] = slug.split("/");
  if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;
  return { owner, repo };
}

/** Case-insensitive, like GitHub. Returns the allow-list's own spelling, or null when the slug is not on it. */
export function matchAllowedRepo(allowed: readonly string[], slug: string | null | undefined): string | null {
  const parsed = parseRepoSlug(slug);
  if (!parsed) return null;
  const wanted = `${parsed.owner}/${parsed.repo}`.toLowerCase();
  return allowed.find((candidate) => candidate.toLowerCase() === wanted) ?? null;
}

/* -------------------------------------------------------------- path guard */

const GUARDED_DIRS = /^(\.github|\.gitlab|\.circleci|\.git|\.husky|\.devcontainer|\.vscode|node_modules)$/i;
const GUARDED_FILES: ReadonlyArray<[RegExp, string]> = [
  [/^\.env/i, "an environment file"],
  [/^(package\.json|pnpm-workspace\.yaml|\.npmrc|\.yarnrc(\.yml)?)$/i, "package configuration"],
  [/^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|gemfile\.lock|cargo\.lock|poetry\.lock|go\.sum)$/i, "a lockfile"],
  [/^(\.gitlab-ci\.yml|\.travis\.yml|azure-pipelines\.yml|bitbucket-pipelines\.yml|jenkinsfile|\.gitattributes|\.gitmodules)$/i, "CI configuration"],
  [/^(wrangler\.[\w.]+|[\w.-]+\.config\.[cm]?[jt]sx?|[\w.-]+\.config\.json|tsconfig[\w.-]*\.json|dockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|netlify\.toml|vercel\.json|fly\.toml|procfile|makefile)$/i, "build or deploy configuration"],
];

/**
 * Why a pull request must never touch this path, or null when it may. Enforced
 * in code, after the model and before any commit: the path comes from a code
 * search seeded with text from the scanned site, which is untrusted, so
 * nothing upstream is allowed to be the only thing between that text and the
 * repository's CI, secrets or dependencies.
 */
export function committablePathProblem(path: string): string | null {
  if (!path || path !== path.trim()) return "the path is empty or padded";
  if (path.length > 300) return "the path is too long";
  if (/[\u0000-\u001f\u007f]/.test(path)) return "the path has control characters";
  if (path.includes("\\")) return "the path has a backslash";
  if (path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:/.test(path)) return "the path is absolute";
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return "the path has empty, '.' or '..' segments";
  const guardedDir = segments.slice(0, -1).find((segment) => GUARDED_DIRS.test(segment));
  if (guardedDir) return `${guardedDir}/ is off limits`;
  const name = segments[segments.length - 1] ?? "";
  for (const [pattern, what] of GUARDED_FILES) if (pattern.test(name)) return `${name} is ${what}`;
  if (!isSourcePath(path)) return "it is not a source file Friction edits";
  return null;
}

export function isCommittablePath(path: string): boolean {
  return committablePathProblem(path) === null;
}

/* -------------------------------------------------------------- line counts */

/** Lines added and removed between two versions of a file (LCS over the lines that differ). */
export function countLineChanges(before: string, after: string): { addedLines: number; removedLines: number } {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const rows = endA - start;
  const cols = endB - start;
  // A rewrite too large to diff cheaply is reported as a whole replacement rather than stalling the process.
  if (rows * cols > 4_000_000) return { addedLines: cols, removedLines: rows };
  let previous = new Array<number>(cols + 1).fill(0);
  for (let i = 1; i <= rows; i++) {
    const current = new Array<number>(cols + 1).fill(0);
    for (let j = 1; j <= cols; j++) {
      current[j] = a[start + i - 1] === b[start + j - 1] ? (previous[j - 1] ?? 0) + 1 : Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
    }
    previous = current;
  }
  const common = previous[cols] ?? 0;
  return { addedLines: cols - common, removedLines: rows - common };
}

/* ---------------------------------------------------------------- planning */

/** What planning needs to know about one fix. `hasContent`: the row holds the complete new file. */
export interface PlannableFix {
  findingId: string;
  stage: FixStage;
  sourceFile: string | null;
  hasContent: boolean;
  /** The verdict's note, quoted when a rejected fix is listed under "Found, not fixed". */
  note?: string;
  prUrl?: string | null;
}

export interface PlannableTask {
  taskIndex: number;
  runId: string;
  /** In rank order: the order the run verified them, which is selectTopFindings' order. */
  fixes: readonly PlannableFix[];
}

export interface TaskPlan {
  taskIndex: number;
  runId: string;
  /**
   * open            `commit` is not empty: open (or preview) one PR
   * covered         something was fixable, and all of it is in another PR
   * nothing_to_fix  no verified, mapped fix
   * skipped         fixable, but every path was refused
   */
  action: "open" | Extract<TaskPullRequestStatus, "covered" | "nothing_to_fix" | "skipped">;
  /** One entry per file, rank order. */
  commit: Array<{ findingId: string; path: string }>;
  /** Fixes whose file another PR claims. Also listed in `notFixed`. */
  covered: Array<{ findingId: string; path: string; coveredBy: CoveredBy }>;
  notFixed: TaskPullRequest["notFixed"];
  /** For a `covered` task: the claim of its highest-ranked covered fix. */
  coveredBy?: CoveredBy;
  /** Later tasks with a fix this task's PR covers, ascending. */
  alsoUnblocks: number[];
  reason?: string;
}

function coveredReason(by: CoveredBy): string {
  return typeof by === "number" ? `Covered by the PR for task ${by + 1}, which already rewrites this file.` : `An open Friction pull request already changes this file: ${by}`;
}

/**
 * Every task's fixes, in rank order, to what each task's pull request does.
 *
 *   - only a verified fix with a mapped file and its new content ships;
 *     everything else is "not fixed", with the reason
 *   - a path the guard refuses never ships, whoever chose it
 *   - within a task, the first (highest-ranked) fix to a file wins: each new
 *     content is a complete replacement of the same original, so a second
 *     commit would erase the first
 *   - across tasks, a file belongs to the first task whose PR touches it;
 *     later fixes to it are `covered`. `claimedFiles` seeds that with files an
 *     open Friction PR from an earlier scan already changes
 *
 * Deterministic: same input, same plan. `claimedFiles` is not mutated.
 */
export function planTaskPullRequests(tasks: readonly PlannableTask[], claimedFiles: ReadonlyMap<string, CoveredBy> = new Map()): TaskPlan[] {
  const claims = new Map(claimedFiles);
  const plans: TaskPlan[] = [];

  for (const task of [...tasks].sort((a, b) => a.taskIndex - b.taskIndex)) {
    const plan: TaskPlan = { taskIndex: task.taskIndex, runId: task.runId, action: "nothing_to_fix", commit: [], covered: [], notFixed: [], alsoUnblocks: [] };
    let fixable = 0;

    for (const fix of task.fixes) {
      const skip = (reason: string): void => void plan.notFixed.push({ findingId: fix.findingId, reason });
      if (fix.stage === "pr_opened") {
        skip(fix.prUrl ? `A pull request for this fix is already open: ${fix.prUrl}` : "A pull request for this fix is already open.");
      } else if (fix.stage === "rejected") {
        skip(fix.note ? `The fix was not verified: ${fix.note}` : "The fix was not verified.");
      } else if (fix.stage !== "verified") {
        skip("The fix was never verified: its verification did not finish.");
      } else if (!fix.sourceFile || !fix.hasContent) {
        skip("The fix was verified in the browser, but could not be mapped to a source file.");
      } else {
        fixable += 1;
        const path = fix.sourceFile;
        const problem = committablePathProblem(path);
        const claim = claims.get(path);
        if (problem) skip(`Friction does not edit ${JSON.stringify(path)}: ${problem}.`);
        else if (plan.commit.some((entry) => entry.path === path)) skip("Maps to a file this PR already rewrites.");
        else if (claim !== undefined) {
          plan.covered.push({ findingId: fix.findingId, path, coveredBy: claim });
          plan.notFixed.push({ findingId: fix.findingId, reason: coveredReason(claim), coveredBy: claim });
          if (typeof claim === "number") {
            const owner = plans.find((other) => other.taskIndex === claim);
            if (owner && !owner.alsoUnblocks.includes(task.taskIndex)) owner.alsoUnblocks.push(task.taskIndex);
          }
        } else plan.commit.push({ findingId: fix.findingId, path });
      }
    }

    if (plan.commit.length > 0) {
      plan.action = "open";
      for (const entry of plan.commit) claims.set(entry.path, task.taskIndex);
    } else if (plan.covered.length > 0) {
      plan.action = "covered";
      plan.coveredBy = plan.covered[0]?.coveredBy;
    } else if (fixable > 0) {
      plan.action = "skipped";
      plan.reason = "Every fix of this task maps to a file Friction does not edit.";
    }
    plans.push(plan);
  }
  return plans;
}

/* ------------------------------------------------------------------ totals */

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "4 draft PRs opened, 2 tasks covered, 4 had nothing to fix." Zero counts are left out. */
export function summarizeTaskPullRequests(pullRequests: readonly Pick<TaskPullRequest, "status">[]): TaskPullRequestTotals {
  const counts = Object.fromEntries(TASK_PR_STATUSES.map((status) => [status, 0])) as Record<TaskPullRequestStatus, number>;
  for (const pr of pullRequests) counts[pr.status] += 1;
  const parts = [
    counts.opened > 0 ? `${plural(counts.opened, "draft PR", "draft PRs")} opened` : "",
    counts.dry_run > 0 ? `${plural(counts.dry_run, "draft PR", "draft PRs")} previewed` : "",
    counts.covered > 0 ? `${plural(counts.covered, "task", "tasks")} covered` : "",
    counts.nothing_to_fix > 0 ? `${counts.nothing_to_fix} had nothing to fix` : "",
    counts.skipped > 0 ? `${counts.skipped} skipped` : "",
    counts.failed > 0 ? `${counts.failed} failed` : "",
  ].filter(Boolean);
  return { counts, text: parts.length > 0 ? `${parts.join(", ")}.` : "No pull requests." };
}
