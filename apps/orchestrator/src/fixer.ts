/**
 * FIX PROPOSAL: one OpenAI Responses call with Structured Outputs per finding.
 *
 * The output is a small JavaScript patch that verify.ts installs with
 * page.addInitScript() in a brand-new browser session Friction owns, so the
 * agent meets the "fixed" page from first paint. The patch is a test
 * instrument: it only ever changes that disposable session's DOM, never the
 * user's site, server or repository. (The repository change is a separate
 * path: repo.ts and pr.ts, which never read from the browser.)
 */
import OpenAI from "openai";
import { z } from "zod";
import { FRICTION_LABELS, MAX_PATCH_LINES, validatePatch, type FrictionCategory, type FrictionPayload, type Severity, type StepEvent } from "@friction/shared";
import type { Config } from "./config";
import { FixReport } from "./fixReport";
import { errorMessage, log, truncate } from "./util";
import type { WorkerClient } from "./workerClient";

/** How much of the accessibility tree the model sees. */
const MAX_TREE_LINES = 250;

/** What a fix is proposed against: one deduplicated primary-lane finding. */
export interface FindingForFix {
  findingId: string;
  category: FrictionCategory;
  severity: Severity;
  summary: string;
  whyItMatters: string;
  recommendation: string;
  /** e.g. "xpath=/html/body/main/div/div[2]/form/button"; "" when the finding has no element. */
  selector: string;
  targetLabel: string;
  /** Page the failing step was on. */
  url: string;
  /** seq of the first step that evidenced it. */
  evidenceSeq: number;
  hitCount: number;
  /** Other visible text tied to it (an overlay's title, an error message): clues for finding its source. */
  texts: string[];
}

export interface FixProposal {
  /** One sentence: what the fix does. */
  summary: string;
  patchJs: string;
}

export interface ProposeFixInput {
  task: string;
  finding: FindingForFix;
  /** Primary-lane steps, oldest first. Those up to the failing step are used. */
  stepEvents: readonly StepEvent[];
  /** Pruned accessibility tree the agent saw at the failing step; null when there was no browser (mock). */
  tree: readonly string[] | null;
  /** The real markup at the failing step: the target element and any overlay covering the page. Null in mock mode and on older runs. */
  html?: { target: string; overlay: string } | null;
  /** The retry: the patch that was verified and rejected, the verdict's sentence on what is still wrong, and what the agent did with it installed. */
  previous?: { patchJs: string; note: string; steps?: readonly StepEvent[] };
}

export type FixProposer = (input: ProposeFixInput) => Promise<FixProposal>;

const FixProposalSchema = z.object({ summary: z.string().min(8), patchJs: z.string().min(1) });

const FIX_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "patchJs"],
  properties: {
    summary: { type: "string", description: 'One sentence, present tense: what the patch changes for the user. E.g. "Shows \\"Please select a size\\" and focuses the size options when Add to cart is pressed with no size chosen."' },
    patchJs: { type: "string", description: `The complete script, at most ${MAX_PATCH_LINES} lines. Plain browser JavaScript, no markdown fences.` },
  },
} as const;

/* ----------------------------------------------------------------- prompt */

/**
 * Every rule under "Patches that were rejected" is a defect seen in a real
 * rejected patch (three live scans, 2026-09-19), not a guess at best practice.
 */
const INSTRUCTIONS = [
  "You write a small JavaScript patch that fixes ONE specific usability problem on a web page, so that a test can check whether the fix lets a user complete their task.",
  "How it runs: Playwright's page.addInitScript() installs it in a disposable test browser. It runs on EVERY document load, BEFORE the page's own scripts and before <body> exists. It never reaches the real site or its users.",
  "How it is judged: the same task is re-run from scratch by an agent that reads the accessibility tree and clicks real elements. The fix passes when THIS element's problem no longer occurs and the task still completes. A patch that makes the page harder to use fails, even if the problem is gone.",
  "Rules:",
  "- Plain browser JavaScript (ES2020). Self-contained: no imports, no network (no fetch, XMLHttpRequest, WebSocket, sendBeacon), no cookies, no eval.",
  "- Never navigate from script: no assignment to location or location.href, no location.assign/replace/reload, no window.open, no history.pushState. When a control should take the visitor somewhere, make it a real link and let the browser navigate: set the href attribute of the <a> (element.setAttribute('href', url)), or call .click() on the working link that already goes there.",
  "- Wrap everything in try/catch. Never throw.",
  "- Elements may not exist yet. Prefer ONE delegated listener on document (capture phase), which needs no element up front. When you must touch an element, wait for DOMContentLoaded and use a MutationObserver for late renders.",
  "- Select the element by what the MARKUP below shows: an id, a data-* attribute, a name, a class that is clearly its own, an aria-label. Do not guess class names that are not in the markup. Do not use the XPath: removing or adding a node shifts it.",
  "- Scope it: check location.pathname when the problem is page-specific, so other pages are untouched.",
  "- Make the behaviour genuinely work for a person. Do not merely hide the symptom. By category:",
  "    dead_click: make the click do what it should; or give visible, actionable feedback in the page (say what is missing, in an element with role=\"alert\", and move focus to what is missing); or remove the disabled/pending state that blocks it. When the handler exists but returns early, satisfy its precondition or explain it; do not stopPropagation() on the click, which kills the page's own handler too.",
  "    retry: give immediate visible feedback on press, and make the action succeed or explain why not.",
  "    keyboard_trap: make the unreachable control focusable (tabindex=\"0\") and operable (keydown Enter/Space/Escape); move focus into dialogs when they open.",
  "    modal_interrupt: stop the overlay appearing. Remove the overlay's own root element (the one in the markup below) with .remove(), then undo what it did to the page: overflow on <html> and <body>, and any inert or aria-hidden it set on the page's content.",
  "    error_text: prevent the error before commit (mark unavailable options as unavailable and disabled), or make the message say how to fix it.",
  "    ambiguous_label: give each control a unique accessible name (aria-label) that includes its context, e.g. the product it belongs to.",
  "    long_wait: acknowledge the wait at once with a visible loading state.",
  "    loop / step_budget: surface the information the visitor kept going back and forth for, on the page where they need it.",
  "Patches that were rejected, and why. Do not repeat these:",
  "- Finding an overlay by text (el.textContent.includes('10% off')) over many elements ('body *', 'body > *', '.modal, .overlay, .popup'). EVERY ancestor of the overlay contains that text too, so the patch hid or removed the page's root and the agent could do nothing. Match the overlay's own root by its id, class, role or aria-label from the markup; if you must test text, test it on that one element only.",
  "- A MutationObserver with attributes: true (or characterData) whose callback sets styles or attributes. That re-triggers itself forever and freezes the page. Observe { childList: true, subtree: true } only, do nothing when there is nothing to do, and disconnect() once the job is done for good.",
  "- Hiding with display:none plus aria-hidden while leaving the overlay's buttons in the DOM, then listening for clicks on them. The agent can no longer see them, and the page's scroll lock stayed on. Remove the root element instead.",
  "- Re-scanning the whole document on every mutation (querySelectorAll('body *')). Look up one element by one selector.",
  "- Navigating from script to fix a dead link. It is refused before it runs; make it a real link.",
  `- At most ${MAX_PATCH_LINES} lines. At most one short comment line.`,
].join("\n");

function trail(stepEvents: readonly StepEvent[], evidenceSeq: number, keep = 6): string {
  return stepEvents
    .filter((s) => s.seq <= evidenceSeq)
    .slice(-keep)
    .map((s) => {
      const p = s.payload;
      const marker = s.seq === evidenceSeq ? "   <-- the problem" : "";
      return `  ${p.actionType} "${p.targetLabel}" on ${p.url} (domChanged=${p.domChanged}) thinking: ${p.rationale}${marker}`;
    })
    .join("\n");
}

function inputText(input: ProposeFixInput): string {
  const { finding, tree } = input;
  const treeLines = tree ? tree.slice(0, MAX_TREE_LINES) : [];
  return [
    `Task the visitor was attempting: ${input.task}`,
    `Problem: ${finding.category} (${FRICTION_LABELS[finding.category].label}), severity ${finding.severity}/5, hit ${finding.hitCount} time(s) in one run.`,
    `What happened: ${finding.summary}`,
    `Why it matters: ${finding.whyItMatters}`,
    `Element: ${finding.selector || "(none)"}${finding.targetLabel ? ` named "${finding.targetLabel}"` : ""}`,
    ...(input.html?.target ? ["The element's markup, inside its ancestors' opening tags (select it by what you see here):", input.html.target] : []),
    ...(input.html?.overlay ? ["Markup of the overlay covering the page at that step (its FIRST lines are ancestors; the last is the overlay's own root):", input.html.overlay] : []),
    `Page: ${finding.url}`,
    `Recommended fix: ${finding.recommendation}`,
    "Steps up to the problem:",
    trail(input.stepEvents, finding.evidenceSeq) || "  (none)",
    "Accessibility tree at the failing step (interactive elements and headings, one per line as [id] role: name):",
    treeLines.length > 0 ? treeLines.join("\n") : "(not available)",
    ...(tree && tree.length > MAX_TREE_LINES ? [`(${tree.length - MAX_TREE_LINES} more lines omitted)`] : []),
    ...(input.previous
      ? [
          "",
          "A previous patch for this problem was installed, the task was re-run from scratch, and the patch did NOT fix it.",
          `Result of that run: ${input.previous.note}`,
          "The previous patch:",
          input.previous.patchJs,
          ...(input.previous.steps && input.previous.steps.length > 0 ? ["What the agent did with that patch installed (its last steps):", trail(input.previous.steps, Number.MAX_SAFE_INTEGER, 8)] : []),
          "It loaded and ran, so the approach is what failed: it matched the wrong element, acted too late, changed something the visitor does not depend on, or made the page harder to use than before. When the result says the agent no longer completed the task, the patch broke something the task needs: check it against the rejected patterns above. Write a different patch that addresses what the result says is still wrong. Do not repeat it.",
        ]
      : []),
  ].join("\n");
}

/* ------------------------------------------------------------------ model */

/** The live proposer. Throws when no acceptable patch comes back after one corrective retry. */
export function openAIFixer(config: Config): FixProposer {
  const client = new OpenAI({ apiKey: config.openaiApiKey ?? undefined, maxRetries: 1, timeout: 60_000 });
  return async (input) => {
    const model = config.openaiModel;
    if (!model) throw new Error("OPENAI_MODEL is not set");
    let feedback = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await client.responses.create({
        model,
        instructions: INSTRUCTIONS,
        input: feedback ? `${inputText(input)}\n\nYour previous patch was rejected: ${feedback}. Write a corrected one.` : inputText(input),
        store: false,
        text: { format: { type: "json_schema", name: "fix_proposal", schema: FIX_JSON_SCHEMA as unknown as Record<string, unknown>, strict: true } },
        ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort as "low" } } : {}),
      });
      const parsed = FixProposalSchema.safeParse(JSON.parse(response.output_text));
      if (!parsed.success) {
        feedback = "the response did not match the schema";
        continue;
      }
      const problem = validatePatch(parsed.data.patchJs);
      if (!problem) return { summary: parsed.data.summary.trim(), patchJs: parsed.data.patchJs.trim() };
      feedback = problem;
      log("fixer", `${input.finding.findingId}: attempt ${attempt} rejected: ${problem}`);
    }
    throw new Error(`no acceptable patch for ${input.finding.findingId}: ${feedback}`);
  };
}

/** Proposes, validates, and never returns an unacceptable patch. */
export async function proposeFix(proposer: FixProposer, input: ProposeFixInput): Promise<FixProposal> {
  const proposal = await proposer(input);
  const problem = validatePatch(proposal.patchJs);
  if (problem) throw new Error(`proposal for ${input.finding.findingId} rejected: ${problem}`);
  return proposal;
}

/** A primary-lane finding, as the emitter reported it, in the shape a fix is proposed against. */
export function findingForFix(payload: FrictionPayload, steps: readonly StepEvent[]): FindingForFix | null {
  if (!payload.findingId) return null;
  const evidence = steps.find((s) => s.seq === payload.evidenceSeq);
  return {
    findingId: payload.findingId,
    category: payload.category,
    severity: payload.severity,
    summary: payload.summary ?? FRICTION_LABELS[payload.category].blurb,
    whyItMatters: payload.whyItMatters ?? "",
    recommendation: payload.recommendation,
    selector: payload.selector ?? evidence?.payload.selector ?? "",
    targetLabel: evidence?.payload.targetLabel ?? "",
    url: evidence?.payload.signals?.urlAfter ?? evidence?.payload.url ?? "",
    evidenceSeq: payload.evidenceSeq,
    hitCount: payload.hitCount ?? 1,
    texts: [evidence?.payload.signals?.modalLabel ?? "", ...(evidence?.payload.signals?.errorTexts ?? [])].filter(Boolean),
  };
}

/**
 * Phase one of a fix's life: propose it and report it as "proposed". Returns
 * the fix's handle for the later stages, or null when no acceptable patch
 * could be produced. That is recorded too, as a rejected fix with no patch, so
 * the finding's story says where it stopped.
 *
 * With `retryOf` (the rejected fix's handle) the new proposal goes onto the
 * SAME row: a finding has one fix, however many attempts it took. A retry
 * that yields no patch leaves the row as it was, rejected with its first note.
 */
export async function proposeAndReport(args: {
  worker: WorkerClient;
  runId: string;
  proposer: FixProposer;
  input: ProposeFixInput;
  retryOf?: FixReport;
}): Promise<FixReport | null> {
  const { finding } = args.input;
  let proposal: FixProposal;
  try {
    proposal = await proposeFix(args.proposer, args.input);
  } catch (err) {
    log("fixer", `${finding.findingId}: no fix proposed: ${errorMessage(err)}`);
    if (!args.retryOf) {
      const note = truncate(`No acceptable patch was proposed, so nothing was verified: ${errorMessage(err)}`, 400);
      const unproposed = new FixReport(args.worker, args.runId, {
        findingId: finding.findingId,
        stage: "rejected",
        summary: "No fix could be proposed for this finding.",
        patchJs: "",
        sourceFile: null,
        before: null,
        after: null,
        prUrl: null,
        category: finding.category,
        note,
      });
      await unproposed.update({});
    }
    return null;
  }
  if (args.retryOf) {
    const first = args.retryOf.state.note ?? "";
    await args.retryOf.update({
      stage: "proposed",
      summary: proposal.summary,
      patchJs: proposal.patchJs,
      after: null,
      attempts: 2,
      note: truncate(`Second attempt. The first fix was rejected: ${first}`, 400),
      liveViewUrl: null,
      replayUrl: null,
    });
    return args.retryOf;
  }
  const report = new FixReport(args.worker, args.runId, {
    findingId: finding.findingId,
    stage: "proposed",
    summary: proposal.summary,
    patchJs: proposal.patchJs,
    sourceFile: null,
    before: null,
    after: null,
    prUrl: null,
    category: finding.category,
  });
  await report.update({});
  return report;
}
