/**
 * REPO MAPPING: from a verified finding to one source file in the connected
 * repository, and the complete new content of that file.
 *
 * This path never reads from the browser. The rendered DOM is not the source
 * code: it goes finding.selector (and the element's visible text; failing
 * those, the verified patch's selectors, then the page's route) -> GitHub
 * code search -> the source file as committed -> a model writes the COMPLETE
 * replacement file (never a diff; LLM patches rarely apply) -> pr.ts commits it.
 */
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import {
  FRICTION_LABELS,
  checkGeneratedFile,
  committablePathProblem,
  patchSearchTerms,
  rankSearchHits,
  routeHits,
  routeSearchTerms,
  searchTermsFor,
  unwrapFence,
  visibleTextTerms,
  type FixPayload,
  type SearchHit,
} from "@friction/shared";
import type { Config, GitHubConfig } from "./config";
import type { FindingForFix } from "./fixer";
import { errorMessage, log, sleep, truncate } from "./util";

/** Search terms tried per source of terms (the code search API allows ~10 requests a minute; githubCall waits out a rate limit). */
const MAX_TERMS = 4;
/** FixPayloadSchema's limit on mappingNote. */
const NOTE_MAX = 500;
/** Candidates whose content is fetched and checked, best first. */
const MAX_CANDIDATES = 3;
/** Files larger than this are not rewritten whole by a model. */
const MAX_FILE_BYTES = 120_000;

export interface SourceFile {
  path: string;
  content: string;
  /** Blob sha on the base branch: createOrUpdateFileContents needs it to replace the file. */
  sha: string;
  /** The branch it was read from. */
  ref: string;
}

export function octokitFor(github: GitHubConfig): Octokit {
  return new Octokit({ auth: github.token, userAgent: "friction-fix-verification", request: { timeout: 20_000 }, ...(github.apiUrl ? { baseUrl: github.apiUrl.replace(/\/+$/, "") } : {}) });
}

/* ------------------------------------------------------------ GitHub calls */

const GITHUB_ATTEMPTS = 3;
/** The longest a retry-after is honoured for; a longer one ends the call with the wait in its message. */
const MAX_RETRY_AFTER_MS = 45_000;

export function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : undefined;
}

function headerOf(err: unknown, name: string): string | undefined {
  const headers = (err as { response?: { headers?: Record<string, string | number | undefined> } } | null)?.response?.headers;
  const value = headers?.[name];
  return value === undefined ? undefined : String(value);
}

/** How long GitHub asked us to wait, or null when the error is not a rate limit. */
function rateLimitWaitMs(err: unknown): number | null {
  const status = statusOf(err);
  if (status !== 429 && status !== 403) return null;
  const retryAfter = Number(headerOf(err, "retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000;
  if (headerOf(err, "x-ratelimit-remaining") === "0") {
    const reset = Number(headerOf(err, "x-ratelimit-reset"));
    return Number.isFinite(reset) ? Math.max(0, reset * 1000 - Date.now()) + 1000 : 60_000;
  }
  return status === 429 ? 5000 : null;
}

/**
 * Every GitHub call goes through here: the client's own 20s timeout, plus
 * bounded retries. A rate limit is retried after GitHub's retry-after. A read
 * is also retried on a 5xx or a network error; a write is not, because it may
 * have been applied, and repeating it would hit our own branch or commit.
 */
export async function githubCall<T>(kind: "read" | "write", label: string, call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const status = statusOf(err);
      const limited = rateLimitWaitMs(err);
      const transient = kind === "read" && (status === undefined || status >= 500);
      if (attempt >= GITHUB_ATTEMPTS || (limited === null && !transient) || (limited !== null && limited > MAX_RETRY_AFTER_MS)) throw err;
      const waitMs = limited ?? 500 * 2 ** (attempt - 1);
      log("github", `${label} failed (${status ?? "network"}); retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1} of ${GITHUB_ATTEMPTS})`);
      await sleep(waitMs);
    }
  }
}

/** One human sentence for a GitHub failure: what a person would need to do about it. */
export function describeGitHubError(err: unknown, github: GitHubConfig): string {
  const status = statusOf(err);
  const slug = `${github.owner}/${github.repo}`;
  const limited = rateLimitWaitMs(err);
  if (limited !== null) return `GitHub's rate limit was reached; try again in about ${Math.max(1, Math.round(limited / 1000))} seconds.`;
  if (status === 401) return "GitHub rejected GITHUB_TOKEN (401): it is wrong or has expired.";
  if (status === 403) return `The token may not do this on ${slug} (403): it needs Contents and Pull requests set to read and write.`;
  if (status === 404) return `${slug} was not found, or the token cannot see it (404).`;
  if (status === 409) return `GitHub reported a conflict on ${slug} (409): ${errorMessage(err)}`;
  if (status === 422) return `GitHub refused the request (422): ${errorMessage(err)}`;
  return status === undefined ? `GitHub could not be reached: ${errorMessage(err)}` : `GitHub answered ${status}: ${errorMessage(err)}`;
}

/** GITHUB_BASE_BRANCH, or the repository's default branch. */
export async function baseBranch(octokit: Octokit, github: GitHubConfig): Promise<string> {
  if (github.baseBranch) return github.baseBranch;
  const { data } = await githubCall("read", "repos.get", () => octokit.rest.repos.get({ owner: github.owner, repo: github.repo }));
  return data.default_branch;
}

async function readFile(octokit: Octokit, github: GitHubConfig, path: string, ref: string): Promise<SourceFile | null> {
  const { data } = await githubCall("read", "repos.getContent", () => octokit.rest.repos.getContent({ owner: github.owner, repo: github.repo, path, ref }));
  if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
  if (data.size > MAX_FILE_BYTES) {
    log("repo", `${path} is ${data.size} bytes; too large to rewrite whole`);
    return null;
  }
  return { path, content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha, ref };
}

/** What a lookup found, and the sentence the fix row keeps about it: which fallback hit, or everything that was tried. */
export interface SourceLookup {
  file: SourceFile | null;
  note: string;
}

const quoted = (terms: readonly string[]): string => terms.map((t) => `"${t}"`).join(", ");

/** One content search per term; one bad term (rate limit, a query GitHub refuses) must not sink the others. */
async function searchCode(octokit: Octokit, github: GitHubConfig, terms: readonly string[]): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  for (const term of terms) {
    try {
      const { data } = await githubCall("read", "search.code", () =>
        octokit.rest.search.code({ q: `"${term.replace(/"/g, "")}" repo:${github.owner}/${github.repo}`, per_page: 30 }),
      );
      for (const item of data.items) hits.push({ path: item.path, terms: [term] });
    } catch (err) {
      log("repo", `search "${term}" failed: ${errorMessage(err)}`);
    }
  }
  return hits;
}

/** Every file path on the branch, for the route fallback: matched by name, so no search index is involved. */
async function listPaths(octokit: Octokit, github: GitHubConfig, ref: string): Promise<string[]> {
  const { data } = await githubCall("read", "git.getTree", () => octokit.rest.git.getTree({ owner: github.owner, repo: github.repo, tree_sha: ref, recursive: "true" }));
  return data.tree.flatMap((entry) => (entry.type === "blob" && entry.path ? [entry.path] : []));
}

/**
 * The single best source file for a finding, or none. None is a normal
 * outcome, not a failure: the fix stays verified-but-unmapped, and the note
 * says what was searched for.
 *
 * Four sources of search terms, in order, stopping at the first that yields a
 * file: the finding's selector and label; the selectors of the VERIFIED patch
 * (it was proven to touch the right element); the parts of the target's
 * visible text; the finding's page route, matched against file paths under a
 * routes directory. Whatever the source, the candidates go through
 * rankSearchHits and the path guard: text from the scanned site only ever
 * suggests, it never chooses a file.
 */
export async function findSourceFile(github: GitHubConfig, finding: FindingForFix, patchJs = ""): Promise<SourceLookup> {
  const tiers: Array<{ name: string; terms: string[]; byPath?: boolean }> = [
    { name: "the finding's selector and label", terms: searchTermsFor({ selector: finding.selector, targetLabel: finding.targetLabel, texts: finding.texts }) },
    { name: "the verified patch's selectors", terms: patchSearchTerms(patchJs) },
    { name: "the target's visible text", terms: visibleTextTerms([finding.targetLabel, ...finding.texts]) },
    { name: "the page route", terms: routeSearchTerms(finding.url), byPath: true },
  ];

  const octokit = octokitFor(github);
  const tried: string[] = [];
  const seen = new Set<string>();
  try {
    const ref = await baseBranch(octokit, github);
    for (const tier of tiers) {
      const terms = tier.terms.filter((t) => !seen.has(t.toLowerCase())).slice(0, MAX_TERMS);
      if (terms.length === 0) continue;
      terms.forEach((t) => seen.add(t.toLowerCase()));
      tried.push(`${quoted(terms)} (${tier.name})`);

      const hits = tier.byPath ? routeHits(await listPaths(octokit, github, ref), terms) : await searchCode(octokit, github, terms);
      const ranked = rankSearchHits(hits, terms).filter((hit) => committablePathProblem(hit.path) === null);
      for (const candidate of ranked.slice(0, MAX_CANDIDATES)) {
        const file = await readFile(octokit, github, candidate.path, ref).catch(() => null);
        // The search index can lag the branch: only accept a file that really contains a term today. A path match needs no such check.
        if (file && (tier.byPath || terms.some((t) => file.content.toLowerCase().includes(t.toLowerCase())))) {
          log("repo", `${finding.findingId}: mapped to ${file.path} by ${tier.name} (matched ${candidate.terms.join(", ")})`);
          return { file, note: `Mapped by ${tier.name}: ${quoted(candidate.terms)}.` };
        }
      }
      log("repo", `${finding.findingId}: ${tier.name} found no source file for ${quoted(terms)}`);
    }
  } catch (err) {
    log("repo", `${finding.findingId}: repository lookup failed: ${errorMessage(err)}`);
    return { file: null, note: truncate(`The repository lookup failed: ${errorMessage(err)}`, NOTE_MAX) };
  }

  if (tried.length === 0) {
    log("repo", `${finding.findingId}: nothing to search for (no element, no name, no patch selectors, no route)`);
    return { file: null, note: "There was nothing to search the repository for: the finding has no element or name, and the patch no selectors." };
  }
  return { file: null, note: truncate(`Searched for ${tried.join("; ")}: no source file matched.`, NOTE_MAX) };
}

/* ------------------------------------------------------- source generation */

const INSTRUCTIONS = [
  "You edit ONE source file in a repository to fix a usability problem that has been verified in a real browser.",
  "You get the problem, the JavaScript patch that fixed it at runtime in a disposable test browser, and the complete current file.",
  "The runtime patch shows the intended BEHAVIOUR. It is not code to paste: it manipulated the rendered DOM, while this file is the source that renders it.",
  "Make the smallest change to this file that produces the same behaviour idiomatically for this codebase: its framework, components, state, styling and conventions. Change the markup, component or handler itself; never add DOM-patching code or global event listeners.",
  "Keep everything else exactly as it is: imports, formatting, comments, ordering.",
  "Output ONLY the complete new content of the file. No diff, no markdown fences, no explanation before or after.",
  "If this file cannot implement the fix, output the file unchanged.",
].join("\n");

export type SourceFixer = (args: { finding: FindingForFix; fix: FixPayload; sourceFile: SourceFile }) => Promise<string>;

function inputText({ finding, fix, sourceFile }: Parameters<SourceFixer>[0]): string {
  return [
    `Problem: ${finding.category} (${FRICTION_LABELS[finding.category].label}). ${finding.summary}`,
    `Why it matters: ${finding.whyItMatters}`,
    `Recommended fix: ${finding.recommendation}`,
    `Element: ${finding.selector || "(none)"}${finding.targetLabel ? ` named "${finding.targetLabel}"` : ""} on ${finding.url}`,
    `Verified runtime fix: ${fix.summary}`,
    "Runtime patch (behaviour reference only):",
    fix.patchJs,
    "",
    `File: ${sourceFile.path}`,
    "----- BEGIN FILE -----",
    sourceFile.content,
    "----- END FILE -----",
  ].join("\n");
}

/**
 * The COMPLETE new file content, checked: non-empty, changed, not a diff, not
 * wildly shorter than the original. One corrective retry, then it throws.
 */
export function openAISourceFixer(config: Config): SourceFixer {
  const client = new OpenAI({ apiKey: config.openaiApiKey ?? undefined, maxRetries: 1, timeout: 180_000 });
  return async (args) => {
    const model = config.openaiModel;
    if (!model) throw new Error("OPENAI_MODEL is not set");
    let feedback = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await client.responses.create({
        model,
        instructions: INSTRUCTIONS,
        input: feedback ? `${inputText(args)}\n\nYour previous answer was rejected: ${feedback}. Output the complete file again.` : inputText(args),
        store: false,
        // Room for the whole file plus some slack; a file cut off by the limit is caught by the length check.
        max_output_tokens: Math.min(100_000, Math.ceil(args.sourceFile.content.length / 2) + 4000),
        ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort as "low" } } : {}),
      });
      const content = unwrapFence(response.output_text);
      const problem = checkGeneratedFile(args.sourceFile.content, content);
      if (!problem) return content.endsWith("\n") || !args.sourceFile.content.endsWith("\n") ? content : `${content}\n`;
      feedback = problem;
      log("repo", `${args.finding.findingId}: generated ${args.sourceFile.path} rejected (attempt ${attempt}): ${problem}`);
    }
    throw new Error(`no acceptable new content for ${args.sourceFile.path}: ${feedback}`);
  };
}

/** Spec name: finding + verified fix + source file -> the complete new file content. */
export async function generateSourceFix(fixer: SourceFixer, finding: FindingForFix, fix: FixPayload, sourceFile: SourceFile): Promise<string> {
  const content = await fixer({ finding, fix, sourceFile });
  const problem = checkGeneratedFile(sourceFile.content, content);
  if (problem) throw new Error(`generated ${sourceFile.path} rejected: ${problem}`);
  return content;
}
