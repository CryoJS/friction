/**
 * Pure logic of fix verification and pull requests. No SDKs, no network, no
 * clock: the orchestrator does the I/O and calls these, and the tests hold
 * them to the rules that make the feature trustworthy.
 */

import type { FrictionCategory, LaneResult } from "./events";

/* ------------------------------------------------------------------ patch */

/** Longest patch accepted, in lines. */
export const MAX_PATCH_LINES = 40;

const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\b|\bsendBeacon\b/, "makes network requests"],
  [/\beval\s*\(|\bnew\s+Function\b/, "evaluates code from strings"],
  [/document\.cookie/, "touches cookies"],
  [/\blocation\s*(\.\s*href\s*)?=(?!=)|\blocation\.(assign|replace|reload)\s*\(|\bwindow\.open\s*\(|\bhistory\.(push|replace)State\b/, "navigates"],
];

/**
 * Why a patch is unacceptable, or null if it is fine. Never executes it: the
 * syntax check compiles a Function body without calling it. Node only (the
 * orchestrator): Workers forbid `new Function`, and nothing there calls this.
 */
export function validatePatch(js: string): string | null {
  const code = js.trim();
  if (!code) return "the patch is empty";
  if (/^```|```$/.test(code)) return "the patch is wrapped in markdown fences";
  const lines = code.split(/\r?\n/).length;
  if (lines > MAX_PATCH_LINES) return `the patch is ${lines} lines; the cap is ${MAX_PATCH_LINES}`;
  if (!/\btry\s*\{/.test(code) || !/\bcatch\b/.test(code)) return "the patch must wrap its work in try/catch";
  for (const [pattern, why] of FORBIDDEN) if (pattern.test(code)) return `the patch ${why}, which is not allowed`;
  try {
    new Function(code);
  } catch (err) {
    return `the patch does not parse: ${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}

/**
 * What actually gets injected with addInitScript: the patch inside one more
 * try/catch, so even a patch that slipped a throw past its own guard can never
 * break the page load.
 */
export function guardPatch(js: string, fixId?: string): string {
  // The marker lets the verifier READ back that the patch really loaded; it installs nothing.
  const marker = fixId ? `try { window.__frictionFix = ${JSON.stringify(fixId)}; } catch (_frictionError) {}\n` : "";
  return `;(function () {\n${marker}try {\n${js.trim()}\n} catch (_frictionError) {}\n})();\n`;
}

/* -------------------------------------------------------------- selection */

export interface RankableFinding {
  findingId: string;
  severity: number;
  confidence: number;
  hitCount: number;
}

/** Default number of findings verified per run: verification costs a full browser run each. */
export const DEFAULT_VERIFY_TOP_N = 2;

/** The findings worth verifying: highest severity first, then confidence, then how often it was hit. */
export function selectTopFindings<T extends RankableFinding>(findings: readonly T[], n: number): T[] {
  return [...findings]
    .sort((a, b) => b.severity - a.severity || b.confidence - a.confidence || b.hitCount - a.hitCount || a.findingId.localeCompare(b.findingId))
    .slice(0, Math.max(0, n));
}

/* ------------------------------------------------------------ repo mapping */

/**
 * What to search a repository for, most specific first. The rendered DOM is
 * NOT the source, so these are only clues: attribute values the source is
 * likely to contain verbatim, then the element's accessible name, then other
 * visible text (a modal's title, an error message).
 *
 *   button[data-add-to-cart]           -> data-add-to-cart
 *   #add-to-cart.btn-primary           -> add-to-cart, btn-primary
 *   xpath=//button[@data-testid='buy'] -> buy
 *   xpath=/html/body/main/div/button   -> (nothing: structure is not in the source)
 */
export function searchTermsFor(args: { selector: string; targetLabel: string; texts?: readonly string[] }): string[] {
  const terms: string[] = [];
  const add = (term: string): void => {
    const clean = term.replace(/\s+/g, " ").trim();
    if (clean.length >= 3 && !terms.some((t) => t.toLowerCase() === clean.toLowerCase())) terms.push(clean);
  };

  const selector = args.selector.trim();
  if (/^(xpath=|\/)/.test(selector)) {
    // Only predicates carry source-level names: @attr='value', @attr, text()='...'.
    for (const match of selector.matchAll(/@([\w-]+)\s*=\s*["']([^"']+)["']/g)) {
      const [, attr = "", value = ""] = match;
      if (attr === "class") value.split(/\s+/).forEach(add);
      else add(value);
    }
    for (const match of selector.matchAll(/text\(\)\s*=\s*["']([^"']+)["']/g)) add(match[1] ?? "");
  } else if (selector) {
    // CSS: attribute selectors (name, and value when given), ids, classes. Tag names are too generic.
    for (const match of selector.matchAll(/\[\s*([\w-]+)\s*(?:[~|^$*]?=\s*["']?([^"'\]]+)["']?)?\s*\]/g)) {
      const [, attr = "", value] = match;
      if (value && attr !== "type" && attr !== "role") add(value);
      // A custom data attribute's NAME is distinctive on its own; standard ones (name, type) are not.
      if (attr.startsWith("data-")) add(attr);
    }
    for (const match of selector.matchAll(/[#.]([\w-]{3,})/g)) add(match[1] ?? "");
  }

  add(args.targetLabel);
  for (const text of args.texts ?? []) if (text.length <= 80) add(text);
  // Drop generic HTML names that match half a codebase.
  return terms.filter((t) => !/^(id|class|name|type|role|value|href|button|div|span|input|form|label)$/i.test(t));
}

export interface SearchHit {
  path: string;
  /** Which search terms found this file. */
  terms: readonly string[];
}

const SOURCE_EXT = /\.(tsx|jsx|ts|js|mjs|vue|svelte|astro|html?|liquid|erb|hbs|njk|php|py|rb|twig|cshtml|razor)$/i;
const NOT_SOURCE = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|__snapshots__|__mocks__)\/|\.min\.js$|\.(test|spec|stories)\.[jt]sx?$|(^|\/)(test|tests|__tests__|e2e|cypress|playwright)\//i;

/** A file type Friction maps fixes to, outside build output and tests. */
export function isSourcePath(path: string): boolean {
  return SOURCE_EXT.test(path) && !NOT_SOURCE.test(path);
}

/**
 * How good a search hit is: markup and component files over everything else,
 * never build output or tests, more matched terms (and earlier, more specific
 * terms) first. Negative means "do not use".
 */
export function scoreSearchHit(hit: SearchHit, terms: readonly string[]): number {
  if (NOT_SOURCE.test(hit.path) || !SOURCE_EXT.test(hit.path)) return -1;
  let score = 0;
  for (const term of hit.terms) {
    const rank = terms.findIndex((t) => t.toLowerCase() === term.toLowerCase());
    score += rank < 0 ? 1 : 10 + Math.max(0, 5 - rank);
  }
  if (/\.(tsx|jsx|vue|svelte|astro|liquid|html?)$/i.test(hit.path)) score += 3;
  if (/(^|\/)(components?|app|pages|src|templates|sections|snippets|views)\//i.test(hit.path)) score += 1;
  return score;
}

/** Hits merged by path, best first; unusable files dropped. */
export function rankSearchHits(hits: readonly SearchHit[], terms: readonly string[]): SearchHit[] {
  const byPath = new Map<string, Set<string>>();
  for (const hit of hits) {
    const set = byPath.get(hit.path) ?? new Set<string>();
    hit.terms.forEach((t) => set.add(t));
    byPath.set(hit.path, set);
  }
  return [...byPath.entries()]
    .map(([path, set]) => ({ path, terms: [...set] }))
    .map((hit) => ({ hit, score: scoreSearchHit(hit, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.hit.path.length - b.hit.path.length || a.hit.path.localeCompare(b.hit.path))
    .map(({ hit }) => hit);
}

/* ------------------------------------------------------- source generation */

/** Only a model that wrapped the WHOLE answer in one fence gets unwrapped; anything else is left alone. */
export function unwrapFence(text: string): string {
  const match = /^\s*```[\w.+-]*[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text);
  return match ? (match[1] ?? "") : text;
}

/**
 * Is a generated replacement file believable? It must be non-empty, not a
 * diff, actually different, and not wildly shorter than the original (a
 * model that truncates or summarises a file must never reach a PR).
 */
export function checkGeneratedFile(original: string, generated: string): string | null {
  const next = generated.replace(/\r\n/g, "\n");
  const before = original.replace(/\r\n/g, "\n");
  if (!next.trim()) return "the generated file is empty";
  if (/^```/.test(next.trim())) return "the generated file is wrapped in markdown fences";
  if (/^(diff --git|--- a\/|\+\+\+ b\/|@@ -\d)/m.test(next) && !/^(diff --git|--- a\/|@@ -\d)/m.test(before)) return "the output is a diff, not a file";
  if (next.trim() === before.trim()) return "the generated file is identical to the original";
  const ratio = next.length / Math.max(1, before.length);
  if (ratio < 0.6) return `the generated file is ${Math.round(ratio * 100)}% of the original's length; refusing a truncated file`;
  const lines = next.split("\n").length / Math.max(1, before.split("\n").length);
  if (lines < 0.6) return `the generated file has ${Math.round(lines * 100)}% of the original's lines; refusing a truncated file`;
  return null;
}

/* ------------------------------------------------------------ pull request */

export interface PullRequestFacts {
  task: string;
  siteUrl: string;
  finding: {
    findingId: string;
    category: FrictionCategory;
    summary: string;
    whyItMatters: string;
    recommendation: string;
    /** 1-based step number of the first hit in the primary run. */
    stepNumber: number | null;
    hitCount: number;
    url: string;
  };
  fix: {
    summary: string;
    patchJs: string;
    sourceFile: string;
    before: LaneResult;
    after: LaneResult;
  };
  /** Absolute URL of the evidence screenshot (served from R2 by the Worker). */
  evidenceUrl: string | null;
  primaryReplayUrl: string | null;
  verifyReplayUrl: string | null;
}

const PR_TITLE_MAX = 100;

/** "Fix: <finding summary>", trimmed to a sane title length. */
export function pullRequestTitle(summary: string): string {
  const clean = summary.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  const title = `Fix: ${clean}`;
  return title.length <= PR_TITLE_MAX ? title : `${title.slice(0, PR_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * The draft PR's title and body. Every claim is one Friction measured, and the
 * body says exactly what was measured: the behaviour was verified with a
 * runtime patch in a disposable browser; the source change implements that
 * behaviour and has not itself been run.
 */
export function buildPullRequest(facts: PullRequestFacts): { title: string; body: string } {
  const body = [
    "## What the agent was trying to do",
    "",
    `> ${facts.task}`,
    "",
    `on ${facts.siteUrl}`,
    "",
    ...findingSections(facts, "##"),
    "",
    "---",
    PR_FOOTER,
  ].join("\n");

  return { title: pullRequestTitle(facts.finding.summary), body };
}

const PR_FOOTER = "Opened as a draft by Friction. Friction never merges or force-pushes.";

/** One finding's story, "What went wrong" to the verified patch. Shared by the single-fix PR and the task PR. */
function findingSections(facts: Omit<PullRequestFacts, "task" | "siteUrl">, heading: "##" | "###"): string[] {
  const { finding, fix } = facts;
  const recurrence = finding.hitCount > 1 ? `, and it recurred: the agent hit it ${finding.hitCount} times in one run` : "";
  const where = finding.stepNumber !== null ? `at step ${finding.stepNumber}` : "during the run";
  const verified = fix.after.outcome === "success" && fix.before.outcome !== "success"
    ? `Verified: the agent ${describeComparison(fix.before, fix.after)}, with the fix applied.`
    : `Verified: ${finding.category} no longer fired with the fix applied; the agent ${describeComparison(fix.before, fix.after)}.`;
  const link = (label: string, url: string | null): string => (url ? `- ${label}: ${url}` : `- ${label}: not recorded (no Browserbase session)`);

  return [
    `${heading} What went wrong`,
    "",
    `**${finding.summary}** (${finding.category}, ${where} on ${finding.url}${recurrence}.)`,
    "",
    finding.whyItMatters,
    "",
    `${heading} Verification`,
    "",
    verified,
    "",
    `| | Outcome | Steps | Time |`,
    `| --- | --- | --- | --- |`,
    `| Before | ${fix.before.outcome} | ${fix.before.steps} | ${(fix.before.durationMs / 1000).toFixed(1)}s |`,
    `| After | ${fix.after.outcome} | ${fix.after.steps} | ${(fix.after.durationMs / 1000).toFixed(1)}s |`,
    "",
    `How: the same task was re-run from scratch in a fresh browser session with this behaviour installed as a runtime patch (\`addInitScript\`, before the page loaded). ${fix.summary}`,
    "",
    `This PR implements that behaviour in \`${fix.sourceFile}\`. The source change was generated from the verified patch and **has not itself been run**: review it and run your tests before merging.`,
    "",
    `${heading} Evidence`,
    "",
    facts.evidenceUrl ? `- Screenshot of the problem: ${facts.evidenceUrl}` : "- Screenshot of the problem: not captured",
    link("Session replay, before (primary run)", facts.primaryReplayUrl),
    link("Session replay, after (verification run)", facts.verifyReplayUrl),
    "",
    "<details><summary>The runtime patch that was verified</summary>",
    "",
    "```js",
    fix.patchJs.trim(),
    "```",
    "",
    "</details>",
  ];
}

/** Everything one task's pull request says: its committed fixes, and the rest of the task's story. */
export interface TaskPullRequestFacts {
  task: string;
  /** 0-based rank within the scan. */
  taskIndex: number;
  siteUrl: string;
  /** Committed fixes, in rank order; one file each. */
  fixes: ReadonlyArray<Omit<PullRequestFacts, "task" | "siteUrl">>;
  /** Found, not fixed: rejected, unverified, unmapped, guarded or covered elsewhere. */
  notFixed: ReadonlyArray<{ findingId: string; summary: string; reason: string }>;
  /** Later tasks whose fix to one of these files was not committed again, because this PR has it. */
  alsoUnblocks: ReadonlyArray<{ taskIndex: number; title: string }>;
}

/**
 * One draft PR per task: every verified, mapped fix of the task's run, then
 * the other tasks it unblocks and what was found but not fixed, so the PR
 * tells the whole story of the task. The same claims and the same caveats as
 * buildPullRequest, per fix.
 */
export function buildTaskPullRequest(facts: TaskPullRequestFacts): { title: string; body: string } {
  const [first] = facts.fixes;
  if (!first) throw new Error("a task pull request needs at least one fix");
  const many = facts.fixes.length > 1;
  const clean = facts.task.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  const title = many ? pullRequestTitle(`${facts.fixes.length} problems blocking "${clean}"`) : pullRequestTitle(first.finding.summary);

  const body = [
    "## What the agent was trying to do",
    "",
    `> ${facts.task}`,
    "",
    `on ${facts.siteUrl} (task ${facts.taskIndex + 1} of a Friction site scan)`,
    "",
    ...facts.fixes.flatMap((fix, index) =>
      many ? [`## Fix ${index + 1} of ${facts.fixes.length}: \`${fix.fix.sourceFile}\``, "", ...findingSections(fix, "###"), ""] : [...findingSections(fix, "##"), ""],
    ),
    ...(facts.alsoUnblocks.length > 0
      ? [
          "## Also unblocks",
          "",
          "These tasks of the same scan hit a problem in a file this PR already rewrites, so they open no pull request of their own:",
          "",
          ...facts.alsoUnblocks.map((other) => `- Task ${other.taskIndex + 1}: ${other.title}`),
          "",
        ]
      : []),
    ...(facts.notFixed.length > 0
      ? ["## Found, not fixed", "", ...facts.notFixed.map((item) => `- **${item.summary}** (${item.findingId}): ${item.reason}`), ""]
      : []),
    "---",
    PR_FOOTER,
  ].join("\n");

  return { title, body };
}

/** Every branch Friction creates starts with this; re-scans look for open PRs under it. */
export const FRICTION_BRANCH_PREFIX = "friction/";

const refSafe = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").replace(/\.{2,}/g, ".");

/** friction/fix-<findingId>, reduced to characters a git ref allows. */
export function fixBranchName(findingId: string, suffix?: string): string {
  return `${FRICTION_BRANCH_PREFIX}fix-${refSafe(findingId)}${suffix ? `-${refSafe(suffix)}` : ""}`;
}

/** friction/scan-<scanId short>-task-<n>, n 1-based like the UI's T1..T10. */
export function taskBranchName(scanId: string, taskIndex: number, suffix?: string): string {
  const short = refSafe(scanId.replace(/^s_/, "")).slice(0, 8) || "scan";
  return `${FRICTION_BRANCH_PREFIX}scan-${short}-task-${taskIndex + 1}${suffix ? `-${refSafe(suffix)}` : ""}`;
}

/* ---------------------------------------------------------------- verdict */

export interface VerifyObservation {
  result: LaneResult;
  /** The verify run did not run properly (no session, crashed): nothing can be concluded. */
  errored: boolean;
  /** The patch marker was read back from the page after the first navigation. */
  patchActive: boolean;
  /** Hits of the finding's category in the verify run. */
  categoryHits: number;
  /** Did the verify run reach the page the finding happened on? */
  reachedFindingPage: boolean;
}

export interface Verdict {
  stage: "verified" | "rejected";
  /** One line, stated concretely, for the UI and the PR. */
  note: string;
}

const OUTCOME_WORDS: Readonly<Record<LaneResult["outcome"], string>> = { success: "completed the task", failure: "gave up", timeout: "timed out" };

/**
 * "completed the task in 4 steps, down from 13 steps and a timeout". Concrete
 * numbers, both sides, because the comparison is the whole claim.
 */
export function describeComparison(before: LaneResult, after: LaneResult): string {
  const was = before.outcome === "success" ? `${before.steps} steps` : `${before.steps} steps and ${before.outcome === "timeout" ? "a timeout" : "giving up"}`;
  const now = after.outcome === "success" ? `completed the task in ${after.steps} steps` : `${OUTCOME_WORDS[after.outcome]} after ${after.steps} steps`;
  if (after.steps === before.steps && after.outcome === before.outcome) return `${now}, no change from before`;
  const direction = after.steps < before.steps ? "down from" : after.steps > before.steps ? "up from" : "compared with";
  return `${now}, ${direction} ${was}`;
}

/**
 * Did the fix work? Verified when the outcome went from failure/timeout to
 * success, OR the finding's category no longer fires. The second half only
 * counts when the verify run could actually have hit it again: the run ran,
 * the patch was live, and the agent reached the page where the problem was.
 * Anything else is rejected, and says why. A rejection is a result, not an error.
 */
export function judgeVerification(args: { category: FrictionCategory; before: LaneResult; after: VerifyObservation }): Verdict {
  const { category, before, after } = args;
  const comparison = describeComparison(before, after.result);
  if (after.errored) return { stage: "rejected", note: `The verification run did not complete, so nothing could be concluded (${OUTCOME_WORDS[after.result.outcome]} after ${after.result.steps} steps).` };
  if (!after.patchActive) return { stage: "rejected", note: "The fix did not load in the verification session, so it was not tested." };
  if (before.outcome !== "success" && after.result.outcome === "success") return { stage: "verified", note: `With the fix, the agent ${comparison}.` };
  if (after.categoryHits === 0 && after.reachedFindingPage) return { stage: "verified", note: `${category} no longer fires; the agent ${comparison}.` };
  if (after.categoryHits > 0) return { stage: "rejected", note: `${category} still fires (${after.categoryHits} time${after.categoryHits === 1 ? "" : "s"}); the agent ${comparison}.` };
  return { stage: "rejected", note: `The agent never reached the page where ${category} happened, so the fix was not exercised; it ${comparison}.` };
}
