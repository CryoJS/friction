/**
 * PULL REQUEST: commit verified fixes' new file content to a fresh branch and
 * open a DRAFT pull request. Two callers share the steps below:
 *
 *   - a person clicking "Open pull request" on one fix (openPullRequest, here)
 *   - a scan started with a repository and automatic pull requests, once per
 *     task (scanPullRequests.ts)
 *
 *   1. checkBaseFile: the file on the base branch must still be the one the
 *      content was generated from (never silently overwrite a newer version)
 *   2. ensureBranch: a branch of our own from the tip of base (a new name if
 *      that one is taken: existing branches are never touched)
 *   3. commitFile: createOrUpdateFileContents with the complete new content,
 *      one commit per file, on our branch only
 *   4. openDraft: the pull request, as a draft, against the base branch
 *
 * Never merges. Never force-pushes. Uses a personal access token from env.
 */
import type { Octokit } from "@octokit/rest";
import { FRICTION_BRANCH_PREFIX, buildPullRequest, committablePathProblem, fixBranchName, type FixRecord, type RunSnapshot, type StepEvent } from "@friction/shared";
import { githubFor, type Config, type GitHubConfig } from "./config";
import { FixReport } from "./fixReport";
import { baseBranch, describeGitHubError, githubCall, octokitFor, statusOf } from "./repo";
import { log } from "./util";
import type { WorkerClient } from "./workerClient";

export class PullRequestError extends Error {
  constructor(
    message: string,
    /** HTTP status for the orchestrator's route. */
    readonly status: number,
  ) {
    super(message);
    this.name = "PullRequestError";
  }
}

const inFlight = new Set<string>();

/* ------------------------------------------------------------------- steps */

/** One repository, one client. Every step takes it. */
export interface GitHubTarget {
  octokit: Octokit;
  github: GitHubConfig;
  /** The only branch a pull request ever targets. */
  base: string;
  /** Tip of `base` when the target was resolved; every branch starts here. */
  baseSha: string;
}

export async function resolveTarget(github: GitHubConfig): Promise<GitHubTarget> {
  const octokit = octokitFor(github);
  const base = await baseBranch(octokit, github);
  const { data } = await githubCall("read", "git.getRef", () => octokit.rest.git.getRef({ owner: github.owner, repo: github.repo, ref: `heads/${base}` }));
  return { octokit, github, base, baseSha: data.object.sha };
}

/**
 * The blob sha of `path` on the base branch, which the commit needs. Throws a
 * 409 when the file is gone, is not a file, or is no longer the one the new
 * content was generated from.
 */
export async function checkBaseFile(target: GitHubTarget, path: string, sourceSha: string | null): Promise<{ sha: string; content: string }> {
  const { octokit, github, base } = target;
  const current = await githubCall("read", "repos.getContent", () => octokit.rest.repos.getContent({ owner: github.owner, repo: github.repo, path, ref: base })).catch((err: unknown) => {
    throw new PullRequestError(`Could not read ${path} on ${base}: ${statusOf(err) === 404 ? "it no longer exists" : describeGitHubError(err, github)}`, 409);
  });
  if (Array.isArray(current.data) || current.data.type !== "file") throw new PullRequestError(`${path} is not a file on ${base}.`, 409);
  if (sourceSha && current.data.sha !== sourceSha) {
    throw new PullRequestError(`${path} has changed on ${base} since the fix was generated; re-run Friction to regenerate it.`, 409);
  }
  return { sha: current.data.sha, content: "content" in current.data ? Buffer.from(current.data.content, "base64").toString("utf8") : "" };
}

/** Creates the first free name among `candidates` at the tip of base. An existing branch is never reused or overwritten. */
export async function ensureBranch(target: GitHubTarget, candidates: readonly string[]): Promise<string> {
  const { octokit, github, baseSha } = target;
  for (const name of candidates) {
    if (!name.startsWith(FRICTION_BRANCH_PREFIX)) continue;
    try {
      await githubCall("write", "git.createRef", () => octokit.rest.git.createRef({ owner: github.owner, repo: github.repo, ref: `refs/heads/${name}`, sha: baseSha }));
      return name;
    } catch (err) {
      if (statusOf(err) !== 422) throw err; // 422: the branch already exists; try the next name
    }
  }
  throw new PullRequestError("Could not create a branch for the fix: every candidate name is taken.", 409);
}

/** The complete new content of one file, one commit, on our branch only. The path guard is the last thing before the write. */
export async function commitFile(target: GitHubTarget, branch: string, file: { path: string; content: string; fileSha: string; message: string }): Promise<void> {
  const { octokit, github, base } = target;
  const problem = committablePathProblem(file.path);
  if (problem) throw new PullRequestError(`Friction does not edit ${JSON.stringify(file.path)}: ${problem}.`, 409);
  if (!branch.startsWith(FRICTION_BRANCH_PREFIX) || branch === base) throw new PullRequestError(`Refusing to commit to ${branch}: it is not a Friction branch.`, 409);
  await githubCall("write", "repos.createOrUpdateFileContents", () =>
    octokit.rest.repos.createOrUpdateFileContents({
      owner: github.owner,
      repo: github.repo,
      branch,
      path: file.path,
      sha: file.fileSha,
      message: file.message,
      content: Buffer.from(file.content, "utf8").toString("base64"),
    }),
  );
}

/** A draft pull request against the base branch. Never merged by Friction. */
export async function openDraft(target: GitHubTarget, args: { branch: string; title: string; body: string }): Promise<string> {
  const { octokit, github, base } = target;
  const { data: pr } = await githubCall("write", "pulls.create", () =>
    octokit.rest.pulls.create({ owner: github.owner, repo: github.repo, head: args.branch, base, title: args.title, body: args.body, draft: true }),
  );
  log("pr", `opened draft ${pr.html_url} (${args.branch} -> ${base})`);
  return pr.html_url;
}

/** How many open Friction pull requests a re-scan looks into. */
const MAX_OPEN_PRS_CHECKED = 20;

/**
 * Files that an open Friction pull request already changes, by path, with
 * that PR's URL: a re-scan must not open a second PR for the same file.
 * Newest first, bounded to the first 20.
 */
export async function openFrictionClaims(target: GitHubTarget): Promise<Map<string, string>> {
  const { octokit, github } = target;
  const repo = { owner: github.owner, repo: github.repo };
  const { data: open } = await githubCall("read", "pulls.list", () => octokit.rest.pulls.list({ ...repo, state: "open", sort: "created", direction: "desc", per_page: 100 }));
  // The API can only filter on an exact head; ours are recognised by their prefix, on this repository's own branches.
  const ours = open.filter((pr) => pr.head.ref.startsWith(FRICTION_BRANCH_PREFIX) && pr.head.repo?.full_name.toLowerCase() === `${github.owner}/${github.repo}`.toLowerCase());
  const claims = new Map<string, string>();
  // Newest first: when two open pull requests change one path, the newest one's URL is recorded.
  for (const pr of ours.slice(0, MAX_OPEN_PRS_CHECKED)) {
    const { data: files } = await githubCall("read", "pulls.listFiles", () => octokit.rest.pulls.listFiles({ ...repo, pull_number: pr.number, per_page: 100 }));
    for (const file of files) if (!claims.has(file.filename)) claims.set(file.filename, pr.html_url);
  }
  return claims;
}

/* ---------------------------------------------------------- the click path */

/**
 * Opens the draft PR for a verified, mapped fix and reports stage "pr_opened".
 * Idempotent: a fix that already has a PR returns it, and so does a fix whose
 * file a task's pull request of the same scan already covers.
 */
export async function openPullRequest(args: {
  runId: string;
  findingId: string;
  worker: WorkerClient;
  config: Config;
  /** Public base URL of the Worker, for the evidence screenshot link. */
  workerUrl: string;
}): Promise<string> {
  const { runId, findingId, worker, config } = args;

  const key = `${runId}:${findingId}`;
  if (inFlight.has(key)) throw new PullRequestError("A pull request for this fix is already being opened.", 409);
  inFlight.add(key);
  try {
    const fix = await worker.getFix(runId, findingId);
    if (!fix) throw new PullRequestError(`No fix for finding ${findingId} in run ${runId}.`, 404);
    if (fix.stage === "pr_opened" && fix.prUrl) return fix.prUrl;

    // A run that is a task of a scan belongs to the scan's repository, and its task's pull request may already cover this fix.
    const link = await worker.getRunScan(runId);
    const covering = link ? await coveringPullRequest(worker, link.scanId, runId, findingId) : null;
    if (covering) return covering;

    const github = link?.repo ? githubFor(config, link.repo) : config.github;
    if (!github) throw new PullRequestError("GitHub is not connected: set GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO for the orchestrator.", 409);
    if (config.githubDryRun) throw new PullRequestError("GITHUB_DRY_RUN is set: pull requests are previewed, never pushed. Unset it to open one.", 409);
    if (fix.stage !== "verified") throw new PullRequestError(`Only a verified fix gets a pull request; this one is ${fix.stage}.`, 409);
    if (!fix.sourceFile || !fix.newFileContent || !fix.before || !fix.after) {
      throw new PullRequestError("This fix is verified but not mapped to a source file, so there is nothing to commit.", 409);
    }

    const snapshot = await worker.getSnapshot(runId);
    const prUrl = await createDraftPullRequest({ fix: fix as MappedFix, snapshot, github, workerUrl: args.workerUrl });

    const report = new FixReport(worker, runId, fixPayloadOf(fix));
    await report.update({ stage: "pr_opened", prUrl });
    return prUrl;
  } finally {
    inFlight.delete(key);
  }
}

/** The URL of the pull request that already covers this fix within its scan, if one does. */
async function coveringPullRequest(worker: WorkerClient, scanId: string, runId: string, findingId: string): Promise<string | null> {
  const pullRequests = (await worker.getScanTree(scanId).catch(() => null))?.pullRequests ?? [];
  const own = pullRequests.find((pr) => pr.runId === runId);
  if (!own) return null;
  if (own.prUrl && own.findingIds.includes(findingId)) return own.prUrl;
  const by = own.notFixed.find((item) => item.findingId === findingId)?.coveredBy;
  if (by === undefined) return null;
  return typeof by === "string" ? by : (pullRequests.find((pr) => pr.taskIndex === by)?.prUrl ?? null);
}

export type MappedFix = FixRecord & { sourceFile: string; newFileContent: string; before: NonNullable<FixRecord["before"]>; after: NonNullable<FixRecord["after"]> };

export function isMappedFix(fix: FixRecord): fix is MappedFix {
  return Boolean(fix.sourceFile && fix.newFileContent && fix.before && fix.after);
}

/** The event form of a fix row: what a FixReport is started from. */
export function fixPayloadOf(fix: FixRecord) {
  const { id: _id, runId: _runId, newFileContent: _content, sourceSha: _sha, createdAt: _created, updatedAt: _updated, ...payload } = fix;
  return payload;
}

export function commitMessage(fix: FixRecord, runId: string): string {
  return `Fix: ${fix.summary}\n\nVerified by Friction (run ${runId}, finding ${fix.findingId}).`;
}

async function createDraftPullRequest(args: { fix: MappedFix; snapshot: RunSnapshot; github: GitHubConfig; workerUrl: string }): Promise<string> {
  const { fix, snapshot, github } = args;
  const runId = snapshot.run.id;
  try {
    const target = await resolveTarget(github);
    const file = await checkBaseFile(target, fix.sourceFile, fix.sourceSha);
    const branch = await ensureBranch(target, [fixBranchName(fix.findingId), fixBranchName(fix.findingId, runId), fixBranchName(fix.findingId, `${runId}-${Date.now().toString(36)}`)]);
    await commitFile(target, branch, { path: fix.sourceFile, content: fix.newFileContent, fileSha: file.sha, message: commitMessage(fix, runId) });

    const { title, body } = buildPullRequest({ task: snapshot.run.task, siteUrl: snapshot.run.url, ...describeFix(snapshot, fix, args.workerUrl) });
    return await openDraft(target, { branch, title, body });
  } catch (err) {
    if (err instanceof PullRequestError) throw err;
    throw new PullRequestError(describeGitHubError(err, github), 502);
  }
}

/** One fix as a pull request describes it: the finding, the fix, the evidence and both replays. */
export function describeFix(snapshot: RunSnapshot, fix: MappedFix, workerUrl: string) {
  const { primaryStepNumber, evidenceUrl, finding } = describeFinding(snapshot, fix, workerUrl);
  return {
    finding: { ...finding, stepNumber: primaryStepNumber },
    fix: { summary: fix.summary, patchJs: fix.patchJs, sourceFile: fix.sourceFile, before: fix.before, after: fix.after },
    evidenceUrl,
    primaryReplayUrl: snapshot.run.replayUrl,
    verifyReplayUrl: fix.replayUrl ?? null,
  };
}

/** Everything the PR says about the finding, read from the recorded run. */
export function describeFinding(snapshot: RunSnapshot, fix: FixRecord, workerUrl: string) {
  const primary = snapshot.events.filter((e) => e.lane === "primary");
  const steps = primary.filter((e): e is StepEvent => e.type === "step").sort((a, b) => a.seq - b.seq);
  // The latest emission of the finding carries its final hit count.
  const friction = primary
    .flatMap((e) => (e.type === "friction" && (e.payload.findingId ?? `f${e.seq}`) === fix.findingId ? [e.payload] : []))
    .sort((a, b) => (b.hitCount ?? 1) - (a.hitCount ?? 1))[0];
  const evidenceSeq = friction?.evidenceSeq ?? -1;
  const index = steps.findIndex((s) => s.seq === evidenceSeq);
  const evidence = steps[index];
  return {
    primaryStepNumber: index < 0 ? null : index + 1,
    evidenceUrl: evidence?.payload.screenshotKey ? `${workerUrl.replace(/\/+$/, "")}/api/evidence/${evidence.payload.screenshotKey}` : null,
    finding: {
      findingId: fix.findingId,
      category: friction?.category ?? fix.category ?? "dead_click",
      summary: friction?.summary ?? fix.summary,
      whyItMatters: friction?.whyItMatters ?? "",
      recommendation: friction?.recommendation ?? "",
      hitCount: friction?.hitCount ?? 1,
      url: evidence?.payload.url ?? snapshot.run.url,
    },
  };
}
