/**
 * THE PULL REQUEST'S REGRESSION TEST: written as data, proven in a browser,
 * then rendered to a Playwright spec (shared/prTest.ts).
 *
 *   1. one Structured Outputs call turns the finding and its verified fix into
 *      a FixTest: steps by role and accessible name, then expectations
 *   2. Friction runs those steps itself, in two brand-new sessions:
 *        the site as it is           -> must FAIL (it reproduces the problem)
 *        with the verified patch in  -> must PASS (it recognises the fix)
 *   3. only a test that told the two apart is kept. Anything else is dropped
 *      with a sentence, and the pull request opens without a test.
 *
 * The model's output is never executed: it is validated data that this file
 * interprets with a fixed set of actions. What the spec then claims is exactly
 * what was seen; it has not been run against the source change, and says so.
 */
import OpenAI from "openai";
import { FixTestSchema, guardPatch, type FixTest, type FixTestExpectation, type FixTestRole, type StepEvent } from "@friction/shared";
import { openBrowser, type BrowserHandle } from "./browser";
import type { Config } from "./config";
import type { FindingForFix } from "./fixer";
import { errorMessage, log, sleep, withTimeout } from "./util";

/* ------------------------------------------------------------------ writer */

export interface WriteFixTestInput {
  task: string;
  siteUrl: string;
  finding: FindingForFix;
  fixSummary: string;
  patchJs: string;
  /** The primary run's steps up to the problem, and the verify run's steps: how to get there, and what "fixed" looked like. */
  primarySteps: readonly StepEvent[];
  verifySteps: readonly StepEvent[];
  html: { target: string; overlay: string } | null;
}

export type FixTestWriter = (input: WriteFixTestInput) => Promise<FixTest>;

const ROLES = ["button", "link", "textbox", "checkbox", "radio", "combobox", "heading", "dialog", "alert"];
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });

/** Flat on purpose: strict Structured Outputs want every property required, so unused ones are null. */
const TEST_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "startPath", "steps", "expect"],
  properties: {
    title: { type: "string", description: 'What the test shows, as a test title. E.g. "Add to cart says a size is needed".' },
    startPath: { type: "string", description: 'Path the test starts on, beginning with "/". Start on the page where the problem is whenever it can be reached directly.' },
    steps: {
      type: "array",
      description: "At most 8. The shortest way to the problem.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "role", "name", "value", "path", "key", "ms"],
        properties: {
          action: { type: "string", enum: ["goto", "click", "fill", "press", "wait"] },
          role: nullable("string", { enum: [...ROLES, null], description: "click, fill: the element's ARIA role." }),
          name: nullable("string", { description: "click, fill: its accessible name, as in the accessibility tree." }),
          value: nullable("string", { description: "fill: the text." }),
          path: nullable("string", { description: 'goto: a path beginning with "/".' }),
          key: nullable("string", { enum: ["Enter", "Escape", "Tab", "Space", null], description: "press." }),
          ms: nullable("integer", { description: "wait: milliseconds, 100 to 10000. Only for what the page does on a timer." }),
        },
      },
    },
    expect: {
      type: "array",
      description: "1 to 3. What is true once the fix is in, and false today.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "role", "name", "text", "value"],
        properties: {
          kind: { type: "string", enum: ["text_visible", "text_hidden", "role_visible", "role_hidden", "url_contains"] },
          role: nullable("string", { enum: [...ROLES, null] }),
          name: nullable("string"),
          text: nullable("string", { description: "text_visible, text_hidden: visible text, a distinctive part of it." }),
          value: nullable("string", { description: "url_contains." }),
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = [
  "You write a regression test for ONE usability fix, as data. It will be run twice in a real browser: against the site as it is today, where it must FAIL, and with the fix installed, where it must PASS. A test that does not tell the two apart is thrown away.",
  "So: take the shortest path to the problem, then assert the thing the fix makes true.",
  "- Address elements by ARIA role and accessible name, exactly as the accessibility tree and the steps name them. A name matches case-insensitively and may be a distinctive part of the full name.",
  "- Assert what a visitor would see: a message appears (text_visible), an overlay is not there (text_hidden with the overlay's heading, or role_hidden), the page moved on (url_contains), a control exists (role_visible). Prefer text_visible and text_hidden for messages and overlays: dialogs and alerts often have no accessible name.",
  "- Read the patch to learn what the fix makes true: the message it shows, the element it removes, the attribute it sets. Assert that, in the patch's own words where it shows text.",
  "- Do not assert what is already true today. Do not assert the task's end state when the fix only removes one obstacle on the way.",
  "- For something the page does on a timer (a popup after a few seconds), add a wait long enough for it to have appeared today, then assert it is not there.",
  "- Start on the page where the problem is when it has its own URL; otherwise click through from a page that does.",
].join("\n");

function trail(steps: readonly StepEvent[], keep: number): string {
  return steps.slice(-keep).map((s) => `  ${s.payload.actionType} "${s.payload.targetLabel}"${s.payload.value ? ` value "${s.payload.value}"` : ""} on ${s.payload.url} (page changed: ${s.payload.domChanged})`).join("\n");
}

function inputText(input: WriteFixTestInput): string {
  const { finding } = input;
  return [
    `Site: ${input.siteUrl}`,
    `Task the visitor was attempting: ${input.task}`,
    `Problem: ${finding.category}. ${finding.summary}`,
    `Element: "${finding.targetLabel}" on ${finding.url}`,
    ...(input.html?.target ? ["Its markup:", input.html.target] : []),
    ...(input.html?.overlay ? ["Markup of the overlay covering the page:", input.html.overlay] : []),
    `The fix: ${input.fixSummary}`,
    "The runtime patch that was verified:",
    input.patchJs,
    "Steps of the run that hit the problem, up to it:",
    trail(input.primarySteps.filter((s) => s.seq <= finding.evidenceSeq), 8) || "  (none)",
    "Steps of the run with the fix installed:",
    trail(input.verifySteps, 8) || "  (none)",
  ].join("\n");
}

/** The model's flat, nullable answer, as the FixTest it describes. Throws a ZodError when it describes none. */
export function parseFixTest(answer: unknown): FixTest {
  const dropNulls = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(dropNulls) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNulls(v)])) : value;
  return FixTestSchema.parse(dropNulls(answer));
}

/** The live writer. Throws when no valid test comes back after one corrective retry. */
export function openAITestWriter(config: Config): FixTestWriter {
  const client = new OpenAI({ apiKey: config.openaiApiKey ?? undefined, maxRetries: 1, timeout: 60_000 });
  return async (input) => {
    const model = config.openaiModel;
    if (!model) throw new Error("OPENAI_MODEL is not set");
    let feedback = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await client.responses.create({
        model,
        instructions: INSTRUCTIONS,
        input: feedback ? `${inputText(input)}\n\nYour previous answer was rejected: ${feedback}. Answer again.` : inputText(input),
        store: false,
        text: { format: { type: "json_schema", name: "fix_test", schema: TEST_JSON_SCHEMA as unknown as Record<string, unknown>, strict: true } },
        ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort as "low" } } : {}),
      });
      try {
        return parseFixTest(JSON.parse(response.output_text));
      } catch (err) {
        feedback = errorMessage(err);
      }
    }
    throw new Error(`no valid test for ${input.finding.findingId}: ${feedback}`);
  };
}

/* ------------------------------------------------------------------ runner */

const STEP_TIMEOUT_MS = 5000;
const SETTLE_MS = 700;

/**
 * The in-page half of the runner: finds an element by role and accessible
 * name the way Playwright's getByRole would (implicit roles; aria-label,
 * aria-labelledby, <label>, placeholder, alt, value, then text; visible
 * elements only; exact name first, then a part of it), or visible text.
 * Deliberately no smarter than Playwright: a dialog with no accessible name is
 * not found by name here either, so a test cannot pass here and mean nothing
 * there. No regular expressions and no backslashes: this is a template literal.
 */
const PROBE = `
  const norm = (s) => String(s || "").split(String.fromCharCode(10)).join(" ").split(String.fromCharCode(9)).join(" ").split(" ").filter(Boolean).join(" ").toLowerCase();
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const SELECTORS = {
    button: 'button, [role="button"], input[type="button"], input[type="submit"]',
    link: 'a[href], [role="link"]',
    textbox: 'input:not([type]), input[type="text"], input[type="email"], input[type="search"], input[type="tel"], input[type="url"], input[type="password"], input[type="number"], textarea, [role="textbox"], [role="searchbox"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    combobox: 'select, [role="combobox"]',
    heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
    dialog: 'dialog, [role="dialog"], [role="alertdialog"]',
    alert: '[role="alert"]',
  };
  const nameOf = (el) => {
    const by = (el.getAttribute("aria-labelledby") || "").split(" ").filter(Boolean).map((id) => { const n = document.getElementById(id); return n ? n.textContent : ""; }).join(" ");
    const lab = el.labels && el.labels.length ? Array.from(el.labels).map((l) => l.textContent).join(" ") : "";
    const fromContent = el.matches(SELECTORS.dialog) || el.matches(SELECTORS.alert) ? "" : el.innerText || el.textContent;
    return norm(el.getAttribute("aria-label") || by || lab || el.getAttribute("placeholder") || el.getAttribute("alt") || (el.tagName === "INPUT" ? el.value : "") || fromContent);
  };
  const xpathOf = (el) => { const parts = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++; parts.unshift(n.tagName.toLowerCase() + "[" + i + "]"); } return "/" + parts.join("/"); };
  const byRole = (role, name) => {
    const want = norm(name);
    const all = Array.from(document.querySelectorAll(SELECTORS[role] || "frictionnothing")).filter(visible);
    return all.find((el) => nameOf(el) === want) || all.find((el) => nameOf(el).includes(want)) || null;
  };
  const byText = (text) => {
    const want = norm(text);
    const holds = (el) => norm(el.innerText).includes(want);
    return Array.from(document.querySelectorAll("body *")).find((el) => visible(el) && holds(el) && !Array.from(el.children).some((child) => holds(child))) || null;
  };
`;

interface Probe {
  found: boolean;
  xpath: string;
}

const probeRole = (role: FixTestRole, name: string): string => `(() => { ${PROBE} const el = byRole(${JSON.stringify(role)}, ${JSON.stringify(name)}); return { found: Boolean(el), xpath: el ? xpathOf(el) : "" }; })()`;
const probeText = (text: string): string => `(() => { ${PROBE} const el = byText(${JSON.stringify(text)}); return { found: Boolean(el), xpath: el ? xpathOf(el) : "" }; })()`;

async function until(check: () => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

export interface FixTestRun {
  passed: boolean;
  /** What failed, or "" when everything held. */
  detail: string;
}

/** Runs a FixTest on an open page, the way its Playwright rendering would: each locator and each expectation waits up to 5s. */
export async function runFixTest(browser: BrowserHandle, siteUrl: string, test: FixTest): Promise<FixTestRun> {
  const { page, stagehand } = browser;
  const go = (path: string): Promise<unknown> => page.goto(new URL(path, siteUrl).toString(), { waitUntil: "load", timeoutMs: 30_000 });
  const locate = async (role: FixTestRole, name: string): Promise<string | null> => {
    let xpath: string | null = null;
    await until(async () => {
      const probe = await page.evaluate<Probe>(probeRole(role, name));
      xpath = probe.found ? probe.xpath : null;
      return probe.found;
    });
    return xpath;
  };
  const holds = (expectation: FixTestExpectation): Promise<boolean> => {
    switch (expectation.kind) {
      case "text_visible":
        return until(async () => (await page.evaluate<Probe>(probeText(expectation.text))).found);
      case "text_hidden":
        return until(async () => !(await page.evaluate<Probe>(probeText(expectation.text))).found);
      case "role_visible":
        return until(async () => (await page.evaluate<Probe>(probeRole(expectation.role, expectation.name))).found);
      case "role_hidden":
        return until(async () => !(await page.evaluate<Probe>(probeRole(expectation.role, expectation.name))).found);
      case "url_contains":
        return until(async () => page.url().includes(expectation.value));
    }
  };

  await go(test.startPath);
  await sleep(SETTLE_MS);
  for (const [index, step] of test.steps.entries()) {
    if (step.action === "goto") await go(step.path);
    else if (step.action === "wait") await sleep(step.ms);
    else if (step.action === "press") await page.keyPress(step.key);
    else {
      const xpath = await locate(step.role, step.name);
      if (!xpath) return { passed: false, detail: `step ${index + 1}: no ${step.role} named "${step.name}"` };
      const act = step.action === "click" ? { method: "click", arguments: [] } : { method: "fill", arguments: [step.value] };
      await withTimeout(stagehand.act({ selector: `xpath=${xpath}`, description: `${step.role} "${step.name}"`, ...act }), 30_000, step.action);
    }
    await sleep(SETTLE_MS);
  }
  for (const expectation of test.expect) {
    if (!(await holds(expectation))) return { passed: false, detail: `expected ${JSON.stringify(expectation)}` };
  }
  return { passed: true, detail: "" };
}

/* ------------------------------------------------------------------- proof */

export interface FixTestProof {
  proven: boolean;
  /** One sentence for the fix row and the pull request. */
  note: string;
}

/**
 * Runs the test against the site as it is (must fail) and with the patch
 * installed (must pass), each in its own fresh session. Never throws: whatever
 * goes wrong is an unproven test with a sentence.
 */
export async function proveFixTest(args: {
  config: Config;
  siteUrl: string;
  test: FixTest;
  patchJs: string;
  findingId: string;
  /** Tests inject one; live runs open a real session. */
  open?: () => Promise<BrowserHandle>;
}): Promise<FixTestProof> {
  const attempt = async (patched: boolean): Promise<FixTestRun> => {
    let browser: BrowserHandle | null = null;
    try {
      browser = await withTimeout((args.open ?? (() => openBrowser(args.config, "verify")))(), 120_000, "browser session");
      if (patched) await withTimeout(browser.page.addInitScript(guardPatch(args.patchJs, args.findingId)), 15_000, "addInitScript");
      return await withTimeout(runFixTest(browser, args.siteUrl, args.test), 120_000, "regression test");
    } finally {
      await browser?.close().catch(() => undefined);
    }
  };
  try {
    const before = await attempt(false);
    if (before.passed) return { proven: false, note: "No regression test: the one written passes against the site as it is, so it would prove nothing." };
    const after = await attempt(true);
    if (!after.passed) return { proven: false, note: `No regression test: the one written still fails with the verified patch installed (${after.detail}).` };
    log("pr-test", `${args.findingId}: proven (fails today: ${before.detail}; passes with the patch)`);
    return { proven: true, note: `Regression test proven in a browser: it failed against the site as it is (${before.detail}) and passed with the verified patch installed.` };
  } catch (err) {
    return { proven: false, note: `No regression test: it could not be run (${errorMessage(err)}).` };
  }
}
