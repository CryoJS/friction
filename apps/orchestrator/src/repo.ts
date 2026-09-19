/**
 * REPO MAPPING: from a verified finding to one source file in the connected
 * repository, and the complete new content of that file.
 *
 * This path never reads from the browser. The rendered DOM is not the source
 * code: it goes finding.selector (and the element's visible text) -> GitHub
 * code search -> the source file as committed -> a model writes the COMPLETE
 * replacement file (never a diff; LLM patches rarely apply) -> pr.ts commits it.
 */
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import { FRICTION_LABELS, checkGeneratedFile, rankSearchHits, searchTermsFor, unwrapFence, type FixPayload, type SearchHit } from "@friction/shared";
import type { Config, GitHubConfig } from "./config";
import type { FindingForFix } from "./fixer";
import { errorMessage, log } from "./util";

/** Search terms tried per finding (the code search API allows ~10 requests a minute). */
const MAX_TERMS = 4;
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
  return new Octokit({ auth: github.token, userAgent: "friction-fix-verification", request: { timeout: 20_000 } });
}

/** GITHUB_BASE_BRANCH, or the repository's default branch. */
export async function baseBranch(octokit: Octokit, github: GitHubConfig): Promise<string> {
  if (github.baseBranch) return github.baseBranch;
  const { data } = await octokit.rest.repos.get({ owner: github.owner, repo: github.repo });
  return data.default_branch;
}

async function readFile(octokit: Octokit, github: GitHubConfig, path: string, ref: string): Promise<SourceFile | null> {
  const { data } = await octokit.rest.repos.getContent({ owner: github.owner, repo: github.repo, path, ref });
  if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
  if (data.size > MAX_FILE_BYTES) {
    log("repo", `${path} is ${data.size} bytes; too large to rewrite whole`);
    return null;
  }
  return { path, content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha, ref };
}

/**
 * The single best source file for a finding, or null. Null is a normal
 * outcome, not a failure: the fix stays verified-but-unmapped.
 */
export async function findSourceFile(github: GitHubConfig, finding: FindingForFix): Promise<SourceFile | null> {
  const terms = searchTermsFor({ selector: finding.selector, targetLabel: finding.targetLabel, texts: finding.texts }).slice(0, MAX_TERMS);
  if (terms.length === 0) {
    log("repo", `${finding.findingId}: nothing to search for (the selector is structural and the element has no name)`);
    return null;
  }

  const octokit = octokitFor(github);
  try {
    const hits: SearchHit[] = [];
    for (const term of terms) {
      try {
        const { data } = await octokit.rest.search.code({ q: `"${term.replace(/"/g, "")}" repo:${github.owner}/${github.repo}`, per_page: 30 });
        for (const item of data.items) hits.push({ path: item.path, terms: [term] });
      } catch (err) {
        // One bad term (rate limit, a query GitHub refuses) must not sink the others.
        log("repo", `search "${term}" failed: ${errorMessage(err)}`);
      }
    }

    const ranked = rankSearchHits(hits, terms);
    if (ranked.length === 0) {
      log("repo", `${finding.findingId}: no source file matched ${terms.map((t) => `"${t}"`).join(", ")}`);
      return null;
    }

    const ref = await baseBranch(octokit, github);
    for (const candidate of ranked.slice(0, MAX_CANDIDATES)) {
      const file = await readFile(octokit, github, candidate.path, ref).catch(() => null);
      // The search index can lag the branch: only accept a file that really contains a term today.
      if (file && terms.some((t) => file.content.toLowerCase().includes(t.toLowerCase()))) {
        log("repo", `${finding.findingId}: mapped to ${file.path} (matched ${candidate.terms.join(", ")})`);
        return file;
      }
    }
    log("repo", `${finding.findingId}: candidates found, none still contains the terms on ${ref}`);
    return null;
  } catch (err) {
    log("repo", `${finding.findingId}: repository lookup failed: ${errorMessage(err)}`);
    return null;
  }
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
