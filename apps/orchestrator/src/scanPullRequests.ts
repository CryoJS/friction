/**
 * SCAN PULL REQUESTS: once every run of a scan is over, one DRAFT pull request
 * per task that has something to ship. Only for a scan started with a
 * repository and automatic pull requests.
 *
 *   - a task's PR bundles every verified, mapped fix of its run: one branch,
 *     one commit per file (planTaskPullRequests decides what, and why not)
 *   - tasks go one at a time, in rank order, so a file belongs to the first
 *     task whose PR touches it and later tasks are `covered` by that PR
 *   - a file an open Friction PR from an earlier scan already changes is
 *     `covered` by that PR: re-scans never duplicate
 *   - a dry run (GITHUB_DRY_RUN, mock mode, or no token) does everything but
 *     the network writes and stores the would-be PR as a preview
 *
 * Nothing here throws: whatever goes wrong with one task ends as that task's
 * recorded `failed` status with a sentence a person can act on, and the next
 * task carries on. Same steps as the click path (pr.ts); same rules: never
 * merges, never force-pushes, never touches an existing branch.
 */
import {
  buildTaskPullRequest,
  countLineChanges,
  planTaskPullRequests,
  summarizeTaskPullRequests,
  taskBranchName,
  type CoveredBy,
  type FixRecord,
  type PlannableTask,
  type RunSnapshot,
  type TaskPlan,
  type TaskPullRequest,
  type TaskPullRequestFacts,
} from "@friction/shared";
import { githubFor, type Config } from "./config";
import { FixReport } from "./fixReport";
import { mockOriginalFor } from "./mockSource";
import {
  PullRequestError,
  checkBaseFile,
  commitFile,
  commitMessage,
  describeFinding,
  describeFix,
  ensureBranch,
  fixPayloadOf,
  isMappedFix,
  openDraft,
  openFrictionClaims,
  resolveTarget,
  type GitHubTarget,
  type MappedFix,
} from "./pr";
import { describeGitHubError } from "./repo";
import { errorMessage, log, truncate } from "./util";
import type { WorkerClient } from "./workerClient";

/** TaskPullRequestSchema's limits (packages/shared/src/scan.ts). */
const REASON_MAX = 500;
const PREVIEW_BODY_MAX = 60_000;
/** GitHub refuses a pull request body over 65536 characters. */
const PR_BODY_MAX = 65_000;

export interface ScanTaskRun {
  taskIndex: number;
  runId: string;
  title: string;
}

interface TaskWork extends ScanTaskRun {
  /** Null: the Worker could not be read, so nothing is known about this task's fixes. */
  fixes: FixRecord[] | null;
}

/**
 * Opens (or previews) the scan's pull requests and returns every task's
 * outcome, in rank order. `progress` gets the scan's message as it changes.
 */
export async function openScanPullRequests(args: {
  config: Config;
  worker: WorkerClient;
  scanId: string;
  /** "owner/name", already checked against the allow-list when the scan started. */
  repo: string;
  tasks: readonly ScanTaskRun[];
  progress: (message: string) => Promise<void>;
}): Promise<TaskPullRequest[]> {
  const { config, worker, scanId, repo } = args;
  const github = config.mode === "mock" ? null : githubFor(config, repo);
  const dryRun = config.githubDryRun || !github;
  log("scan-pr", `${scanId}: ${dryRun ? "previewing" : "opening"} pull requests against ${repo}`);

  const work: TaskWork[] = [];
  for (const task of [...args.tasks].sort((a, b) => a.taskIndex - b.taskIndex)) {
    const fixes = await worker.getFixes(task.runId).catch((err: unknown) => {
      log("scan-pr", `${scanId} task ${task.taskIndex + 1}: could not read its fixes: ${errorMessage(err)}`);
      return null;
    });
    work.push({ ...task, fixes });
  }

  // One client for the whole scan, and with it the files that open Friction PRs already change.
  let target: GitHubTarget | null = null;
  let targetError: string | null = null;
  const claims = new Map<string, CoveredBy>();
  if (github) {
    try {
      target = await resolveTarget(github);
      for (const [path, prUrl] of await openFrictionClaims(target)) claims.set(path, prUrl);
    } catch (err) {
      targetError = describeGitHubError(err, github);
      log("scan-pr", `${scanId}: ${repo} could not be read: ${targetError}`);
    }
  }

  const total = planTaskPullRequests(work.map(plannable), claims).filter((plan) => plan.action === "open").length;
  const results: TaskPullRequest[] = [];
  let attempt = 0;

  for (const [position, task] of work.entries()) {
    const record = (result: Omit<TaskPullRequest, "scanId" | "runId" | "taskIndex">): TaskPullRequest => ({ scanId, runId: task.runId, taskIndex: task.taskIndex, ...result });
    let result: TaskPullRequest;
    try {
      if (!task.fixes) {
        result = record({ status: "failed", findingIds: [], notFixed: [], reason: "This task's fixes could not be read from the Worker." });
      } else {
        // Planned again from here on, with what actually happened so far: a task whose PR failed claims nothing.
        const [plan] = planTaskPullRequests(work.slice(position).map(plannable), claims);
        if (!plan) {
          result = record({ status: "nothing_to_fix", findingIds: [], notFixed: [] });
        } else if (plan.action !== "open") {
          result = record({ status: plan.action, findingIds: [], notFixed: plan.notFixed, coveredBy: plan.coveredBy, reason: plan.reason });
        } else {
          attempt += 1;
          await args.progress(`${dryRun ? "Previewing" : "Opening"} pull requests (${attempt} of ${Math.max(total, attempt)}).`);
          const titles = new Map(work.map((other) => [other.taskIndex, other.title] as const));
          const alsoUnblocks = plan.alsoUnblocks.map((taskIndex) => ({ taskIndex, title: titles.get(taskIndex) ?? `Task ${taskIndex + 1}` }));
          const snapshot = await worker.getSnapshot(task.runId);
          const job: TaskJob = { scanId, task, fixes: task.fixes, plan, snapshot, alsoUnblocks, workerUrl: config.workerUrl };
          if (dryRun) result = record(await previewTask(job, target));
          else if (!target) result = record({ status: "failed", findingIds: [], notFixed: plan.notFixed, reason: targetError ?? "GitHub could not be reached." });
          else result = record(await openTask(job, target, worker));
        }
      }
    } catch (err) {
      // The belt to every step's braces: one task's failure is that task's status, never the scan's.
      log("scan-pr", `${scanId} task ${task.taskIndex + 1} failed: ${errorMessage(err)}`);
      result = record({ status: "failed", findingIds: [], notFixed: [], reason: errorMessage(err) });
    }

    result = { ...result, reason: result.reason ? truncate(result.reason, REASON_MAX) : undefined, notFixed: result.notFixed.map((item) => ({ ...item, reason: truncate(item.reason, REASON_MAX) })) };
    if (result.status === "opened" || result.status === "dry_run") {
      const committed = new Set(result.findingIds);
      for (const entry of task.fixes ?? []) if (committed.has(entry.findingId) && entry.sourceFile) claims.set(entry.sourceFile, task.taskIndex);
    }
    await worker.upsertTaskPullRequest(result);
    log("scan-pr", `${scanId} task ${task.taskIndex + 1}: ${result.status}${result.prUrl ? ` ${result.prUrl}` : ""}${result.reason ? ` (${result.reason})` : ""}`);
    results.push(result);
  }

  log("scan-pr", `${scanId}: ${summarizeTaskPullRequests(results).text}`);
  return results;
}

function plannable(task: TaskWork): PlannableTask {
  return {
    taskIndex: task.taskIndex,
    runId: task.runId,
    fixes: (task.fixes ?? []).map((fix) => ({
      findingId: fix.findingId,
      stage: fix.stage,
      sourceFile: fix.sourceFile,
      hasContent: isMappedFix(fix),
      note: fix.note,
      prUrl: fix.prUrl,
    })),
  };
}

interface TaskJob {
  scanId: string;
  task: TaskWork;
  fixes: FixRecord[];
  plan: TaskPlan;
  snapshot: RunSnapshot;
  alsoUnblocks: TaskPullRequestFacts["alsoUnblocks"];
  workerUrl: string;
}

type TaskResult = Omit<TaskPullRequest, "scanId" | "runId" | "taskIndex">;

/** The planned commits with their fix rows, in rank order. */
function plannedFixes(job: TaskJob): MappedFix[] {
  return job.plan.commit.flatMap(({ findingId }) => job.fixes.filter((fix): fix is MappedFix => fix.findingId === findingId && isMappedFix(fix)));
}

function pullRequestFor(job: TaskJob, committed: readonly MappedFix[], notFixed: TaskPullRequest["notFixed"]): { title: string; body: string } {
  const { title, body } = buildTaskPullRequest({
    task: job.snapshot.run.task,
    taskIndex: job.task.taskIndex,
    siteUrl: job.snapshot.run.url,
    fixes: committed.map((fix) => describeFix(job.snapshot, fix, job.workerUrl)),
    notFixed: notFixed.map((item) => {
      const fix = job.fixes.find((candidate) => candidate.findingId === item.findingId);
      return { findingId: item.findingId, summary: fix ? describeFinding(job.snapshot, fix, job.workerUrl).finding.summary : item.findingId, reason: item.reason };
    }),
    alsoUnblocks: job.alsoUnblocks,
  });
  return { title, body: truncate(body, PR_BODY_MAX) };
}

function branchCandidates(job: TaskJob): string[] {
  const { scanId, task } = job;
  return [taskBranchName(scanId, task.taskIndex), taskBranchName(scanId, task.taskIndex, task.runId), taskBranchName(scanId, task.taskIndex, `${task.runId}-${Date.now().toString(36)}`)];
}

/**
 * Every file is checked against the base branch first, so a task with nothing
 * left to commit creates no branch. Then the branch, one commit per file, and
 * the draft. A file that cannot be committed is listed as not fixed; the PR
 * opens with the ones that could.
 */
async function openTask(job: TaskJob, target: GitHubTarget, worker: WorkerClient): Promise<TaskResult> {
  const notFixed = [...job.plan.notFixed];
  const sentence = (err: unknown): string => (err instanceof PullRequestError ? err.message : describeGitHubError(err, target.github));

  const ready: Array<{ fix: MappedFix; fileSha: string }> = [];
  for (const fix of plannedFixes(job)) {
    try {
      ready.push({ fix, fileSha: (await checkBaseFile(target, fix.sourceFile, fix.sourceSha)).sha });
    } catch (err) {
      notFixed.push({ findingId: fix.findingId, reason: sentence(err) });
    }
  }
  if (ready.length === 0) return { status: "skipped", findingIds: [], notFixed, reason: "None of this task's files could be committed; see each fix for why." };

  let branch: string;
  try {
    branch = await ensureBranch(target, branchCandidates(job));
  } catch (err) {
    return { status: "failed", findingIds: [], notFixed, reason: sentence(err) };
  }

  const committed: MappedFix[] = [];
  for (const { fix, fileSha } of ready) {
    try {
      await commitFile(target, branch, { path: fix.sourceFile, content: fix.newFileContent, fileSha, message: commitMessage(fix, job.task.runId) });
      committed.push(fix);
    } catch (err) {
      notFixed.push({ findingId: fix.findingId, reason: sentence(err) });
    }
  }
  if (committed.length === 0) return { status: "failed", branch, findingIds: [], notFixed, reason: `Nothing could be committed to ${branch}: ${notFixed[notFixed.length - 1]?.reason ?? "unknown"}` };

  let prUrl: string;
  try {
    prUrl = await openDraft(target, { branch, ...pullRequestFor(job, committed, notFixed) });
  } catch (err) {
    return { status: "failed", branch, findingIds: [], notFixed, reason: `The fix is committed to ${branch}, but the pull request could not be opened: ${sentence(err)}` };
  }

  // Through the existing FixReport, so each fix's own card shows the pull request with no new UI.
  for (const fix of committed) await new FixReport(worker, job.task.runId, fixPayloadOf(fix)).update({ stage: "pr_opened", prUrl });
  return { status: "opened", prUrl, branch, findingIds: committed.map((fix) => fix.findingId), notFixed };
}

/**
 * Everything but the writes. With a token the files are still read (reads
 * change nothing), so the sha check and the line counts are real; without
 * one, mock mode's canned originals stand in.
 */
async function previewTask(job: TaskJob, target: GitHubTarget | null): Promise<TaskResult> {
  const notFixed = [...job.plan.notFixed];
  const files: NonNullable<TaskPullRequest["preview"]>["files"] = [];
  const included: MappedFix[] = [];
  for (const fix of plannedFixes(job)) {
    try {
      const original = target ? (await checkBaseFile(target, fix.sourceFile, fix.sourceSha)).content : (mockOriginalFor(fix.sourceFile) ?? "");
      files.push({ path: fix.sourceFile, ...countLineChanges(original, fix.newFileContent) });
      included.push(fix);
    } catch (err) {
      notFixed.push({ findingId: fix.findingId, reason: err instanceof PullRequestError || !target ? errorMessage(err) : describeGitHubError(err, target.github) });
    }
  }
  if (included.length === 0) return { status: "skipped", findingIds: [], notFixed, reason: "None of this task's files could be committed; see each fix for why." };

  const { title, body } = pullRequestFor(job, included, notFixed);
  return {
    status: "dry_run",
    branch: branchCandidates(job)[0],
    findingIds: included.map((fix) => fix.findingId),
    notFixed,
    preview: { title, body: truncate(body, PREVIEW_BODY_MAX), files },
  };
}
