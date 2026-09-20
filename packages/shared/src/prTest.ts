/**
 * The regression test a pull request ships with. The pure half.
 *
 * A fix's test is DATA, never code: a few steps addressed by role and
 * accessible name, then what must be true afterwards. The orchestrator runs
 * that data in its own browser twice (the site as it is: must FAIL; with the
 * verified patch installed: must PASS), and only a test that told the two
 * apart is rendered, here, into a Playwright spec and committed. Nothing a
 * model wrote is ever executed on this machine, and every string that reaches
 * the spec goes through JSON.stringify: text from the scanned site can name an
 * element, it can never become code.
 */
import { z } from "zod";
import { guardPatch } from "./fixes";

const ROLES = ["button", "link", "textbox", "checkbox", "radio", "combobox", "heading", "dialog", "alert"] as const;
export const FixTestRoleSchema = z.enum(ROLES);
export type FixTestRole = (typeof ROLES)[number];

const name = z.string().trim().min(1).max(120);
const target = { role: FixTestRoleSchema, name };

export const FixTestStepSchema = z.discriminatedUnion("action", [
  /** Same-site only: a path, never a URL. */
  z.object({ action: z.literal("goto"), path: z.string().regex(/^\/(?!\/)[^\s]*$/).max(300) }),
  z.object({ action: z.literal("click"), ...target }),
  z.object({ action: z.literal("fill"), ...target, value: z.string().max(200) }),
  z.object({ action: z.literal("press"), key: z.enum(["Enter", "Escape", "Tab", "Space"]) }),
  /** For what a page does on a timer (a popup after a few seconds). */
  z.object({ action: z.literal("wait"), ms: z.number().int().min(100).max(10_000) }),
]);
export type FixTestStep = z.infer<typeof FixTestStepSchema>;

export const FixTestExpectationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text_visible"), text: name }),
  z.object({ kind: z.literal("text_hidden"), text: name }),
  z.object({ kind: z.literal("role_visible"), ...target }),
  z.object({ kind: z.literal("role_hidden"), ...target }),
  z.object({ kind: z.literal("url_contains"), value: z.string().trim().min(1).max(200) }),
]);
export type FixTestExpectation = z.infer<typeof FixTestExpectationSchema>;

export const FixTestSchema = z.object({
  /** What the test shows, as a test title: "Add to cart says a size is needed". */
  title: z.string().trim().min(5).max(120),
  /** Where it starts, relative to the site. */
  startPath: z.string().regex(/^\/(?!\/)[^\s]*$/).max(300),
  steps: z.array(FixTestStepSchema).max(8),
  expect: z.array(FixTestExpectationSchema).min(1).max(3),
});
export type FixTest = z.infer<typeof FixTestSchema>;

/* -------------------------------------------------------------------- path */

const TEST_DIR = "tests/friction";
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** tests/friction/<scan or run>-<findingId>.spec.ts: Friction's own directory, a new file every time. */
export function fixTestPath(scope: string, findingId: string): string {
  return `${TEST_DIR}/${slug(scope.replace(/^[rs]_/, "")) || "run"}-${slug(findingId) || "fix"}.spec.ts`;
}

/**
 * The ONLY test path a pull request may add. The path guard refuses test
 * files because a fix must never rewrite a repository's tests; this is the one
 * exception, and it is a shape Friction alone produces: flat, under
 * tests/friction/, never an existing file (the commit is a create).
 */
export function isFrictionTestPath(path: string): boolean {
  return /^tests\/friction\/[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/.test(path) && path.length <= 120;
}

/* ------------------------------------------------------------------ render */

const q = (value: string): string => JSON.stringify(value);
/** A line comment cannot be ended by its content. */
const comment = (text: string): string =>
  Array.from(text, (ch) => (ch < " " || ch === String.fromCharCode(0x2028) || ch === String.fromCharCode(0x2029) ? " " : ch))
    .join("")
    .split("*/")
    .join("* /")
    .slice(0, 200);

function locator(role: FixTestRole, accessibleName: string): string {
  return `page.getByRole(${q(role)}, { name: ${q(accessibleName)} }).first()`;
}

function renderStep(step: FixTestStep): string {
  switch (step.action) {
    case "goto":
      return `await page.goto(new URL(${q(step.path)}, BASE_URL).toString());`;
    case "click":
      return `await ${locator(step.role, step.name)}.click();`;
    case "fill":
      return `await ${locator(step.role, step.name)}.fill(${q(step.value)});`;
    case "press":
      return `await page.keyboard.press(${q(step.key === "Space" ? " " : step.key)});`;
    case "wait":
      return `await page.waitForTimeout(${step.ms});`;
  }
}

function renderExpectation(expectation: FixTestExpectation): string {
  switch (expectation.kind) {
    case "text_visible":
      return `await expect(page.getByText(${q(expectation.text)}).first()).toBeVisible();`;
    case "text_hidden":
      return `await expect(page.getByText(${q(expectation.text)}).first()).toBeHidden();`;
    case "role_visible":
      return `await expect(${locator(expectation.role, expectation.name)}).toBeVisible();`;
    case "role_hidden":
      return `await expect(${locator(expectation.role, expectation.name)}).toBeHidden();`;
    case "url_contains":
      return `await expect.poll(() => page.url()).toContain(${q(expectation.value)});`;
  }
}

export interface RenderFixTestArgs {
  test: FixTest;
  /** The scanned site: the default BASE_URL. */
  siteUrl: string;
  findingId: string;
  /** The finding's one line, for the header comment. */
  summary: string;
  /** The verified runtime patch: FRICTION_RUNTIME_PATCH=1 installs it, which shows the test passing against the unfixed site. */
  patchJs: string;
}

/**
 * The spec file. It fails against the site as scanned, passes with
 * FRICTION_RUNTIME_PATCH=1 (Friction saw both), and is meant to pass against
 * the pull request's source change: BASE_URL points it at a local build.
 */
export function renderPlaywrightSpec(args: RenderFixTestArgs): string {
  const { test } = args;
  const body = [`await page.goto(new URL(${q(test.startPath)}, BASE_URL).toString());`, ...test.steps.map(renderStep), ...test.expect.map(renderExpectation)];
  return [
    `// Written by Friction for finding ${comment(args.findingId)}: ${comment(args.summary)}`,
    "//",
    "// Friction ran these steps in its own browser before opening this pull request:",
    "//   - against the site as it was scanned, they FAILED (the problem is real)",
    "//   - with the verified runtime patch installed, they PASSED",
    "// They have NOT been run against this pull request's source change. Run them against your build:",
    "//   npm i -D @playwright/test && npx playwright install chromium",
    "//   BASE_URL=http://localhost:4321 npx playwright test tests/friction",
    "// FRICTION_RUNTIME_PATCH=1 installs the runtime patch instead, to see the test pass against the unfixed site.",
    'import { expect, test } from "@playwright/test";',
    "",
    `const BASE_URL = process.env.BASE_URL ?? ${q(args.siteUrl)};`,
    `const RUNTIME_PATCH = ${q(guardPatch(args.patchJs))};`,
    "",
    `test(${q(test.title)}, async ({ page }) => {`,
    '  if (process.env.FRICTION_RUNTIME_PATCH === "1") await page.addInitScript({ content: RUNTIME_PATCH });',
    ...body.map((line) => `  ${line}`),
    "});",
    "",
  ].join("\n");
}
