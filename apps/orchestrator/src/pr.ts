/**
 * PULL REQUEST: commit a verified fix's new file content to a fresh branch and
 * open a DRAFT pull request. Only ever runs because a person clicked "Open
 * pull request" in the control room; nothing calls it automatically.
 *
 *   1. branch friction/fix-<findingId> from the base branch (a new name if
 *      that one is taken: existing branches are never touched)
 *   2. createOrUpdateFileContents with the complete new file content, only if
 *      the file on the base branch is still the one the content was generated
 *      from (never silently overwrite a newer version)
 *   3. open the pull request as a draft
 *
 * Never merges. Never force-pushes. Uses a personal access token from env.
 */
import { buildPullRequest, fixBranchName, type FixRecord, type RunSnapshot, type StepEvent } from "@friction/shared";
import type { GitHubConfig } from "./config";
import { FixReport } from "./fixReport";
import { baseBranch, octokitFor } from "./repo";
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

function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : undefined;
}

/**
 * Opens the draft PR for a verified, mapped fix and reports stage "pr_opened".
 * Idempotent: a fix that already has a PR returns it.
 */
export async function openPullRequest(args: {
  runId: string;
  findingId: string;
  worker: WorkerClient;
  github: GitHubConfig | null;
  /** Public base URL of the Worker, for the evidence screenshot link. */
  workerUrl: string;
}): Promise<string> {
  const { runId, findingId, worker, github } = args;
  if (!github) throw new PullRequestError("GitHub is not connected: set GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO for the orchestrator.", 409);

  const key = `${runId}:${findingId}`;
  if (inFlight.has(key)) throw new PullRequestError("A pull request for this fix is already being opened.", 409);
  inFlight.add(key);
  try {
    const fix = await worker.getFix(runId, findingId);
    if (!fix) throw new PullRequestError(`No fix for finding ${findingId} in run ${runId}.`, 404);
    if (fix.stage === "pr_opened" && fix.prUrl) return fix.prUrl;
    if (fix.stage !== "verified") throw new PullRequestError(`Only a verified fix gets a pull request; this one is ${fix.stage}.`, 409);
    if (!fix.sourceFile || !fix.newFileContent || !fix.before || !fix.after) {
      throw new PullRequestError("This fix is verified but not mapped to a source file, so there is nothing to commit.", 409);
    }

    const snapshot = await worker.getSnapshot(runId);
    const prUrl = await createDraftPullRequest({ fix: fix as MappedFix, snapshot, github, workerUrl: args.workerUrl });

    const report = new FixReport(worker, runId, withoutRow(fix));
    await report.update({ stage: "pr_opened", prUrl });
    return prUrl;
  } finally {
    inFlight.delete(key);
  }
}

type MappedFix = FixRecord & { sourceFile: string; newFileContent: string; before: NonNullable<FixRecord["before"]>; after: NonNullable<FixRecord["after"]> };

function withoutRow(fix: FixRecord) {
  const { id: _id, runId: _runId, newFileContent: _content, sourceSha: _sha, createdAt: _created, updatedAt: _updated, ...payload } = fix;
  return payload;
}

async function createDraftPullRequest(args: { fix: MappedFix; snapshot: RunSnapshot; github: GitHubConfig; workerUrl: string }): Promise<string> {
  const { fix, snapshot, github } = args;
  const octokit = octokitFor(github);
  const repo = { owner: github.owner, repo: github.repo };
  const base = await baseBranch(octokit, github);

  // The file must still be the one the new content was generated from.
  const current = await octokit.rest.repos.getContent({ ...repo, path: fix.sourceFile, ref: base }).catch((err: unknown) => {
    throw new PullRequestError(`Could not read ${fix.sourceFile} on ${base}: ${statusOf(err) === 404 ? "it no longer exists" : String(err)}`, 409);
  });
  if (Array.isArray(current.data) || current.data.type !== "file") throw new PullRequestError(`${fix.sourceFile} is not a file on ${base}.`, 409);
  if (fix.sourceSha && current.data.sha !== fix.sourceSha) {
    throw new PullRequestError(`${fix.sourceFile} has changed on ${base} since the fix was generated; re-run Friction to regenerate it.`, 409);
  }
  const fileSha = current.data.sha;

  // 1. A branch of our own, from the tip of base. An existing branch is never reused or overwritten.
  const { data: baseRef } = await octokit.rest.git.getRef({ ...repo, ref: `heads/${base}` });
  const candidates = [fixBranchName(fix.findingId), fixBranchName(fix.findingId, snapshot.run.id), fixBranchName(fix.findingId, `${snapshot.run.id}-${Date.now().toString(36)}`)];
  let branch: string | null = null;
  for (const name of candidates) {
    try {
      await octokit.rest.git.createRef({ ...repo, ref: `refs/heads/${name}`, sha: baseRef.object.sha });
      branch = name;
      break;
    } catch (err) {
      if (statusOf(err) !== 422) throw err; // 422: the branch already exists; try the next name
    }
  }
  if (!branch) throw new PullRequestError("Could not create a branch for the fix: every candidate name is taken.", 409);

  // 2. The complete new file content, one commit, on our branch only.
  const { primaryStepNumber, evidenceUrl, finding } = describeFinding(snapshot, fix, args.workerUrl);
  await octokit.rest.repos.createOrUpdateFileContents({
    ...repo,
    branch,
    path: fix.sourceFile,
    sha: fileSha,
    message: `Fix: ${fix.summary}\n\nVerified by Friction (run ${snapshot.run.id}, finding ${fix.findingId}).`,
    content: Buffer.from(fix.newFileContent, "utf8").toString("base64"),
  });

  // 3. A draft pull request. Never merged by Friction.
  const { title, body } = buildPullRequest({
    task: snapshot.run.task,
    siteUrl: snapshot.run.url,
    finding: { ...finding, stepNumber: primaryStepNumber },
    fix: { summary: fix.summary, patchJs: fix.patchJs, sourceFile: fix.sourceFile, before: fix.before, after: fix.after },
    evidenceUrl,
    primaryReplayUrl: snapshot.run.replayUrl,
    verifyReplayUrl: fix.replayUrl ?? null,
  });
  const { data: pr } = await octokit.rest.pulls.create({ ...repo, head: branch, base, title, body, draft: true });
  log("pr", `opened draft ${pr.html_url} (${branch} -> ${base})`);
  return pr.html_url;
}

/** Everything the PR says about the finding, read from the recorded run. */
function describeFinding(snapshot: RunSnapshot, fix: FixRecord, workerUrl: string) {
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
