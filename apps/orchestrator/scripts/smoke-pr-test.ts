/**
 * The pull request's regression test, against REAL browsers. No keys needed.
 *
 *   pnpm --filter @friction/orchestrator smoke:pr-test
 *
 * A local copy of the demo shop (its "Add to cart" silently does nothing until
 * a size is chosen), then two independent checks that must agree:
 *
 *   1. PLAYWRIGHT: the spec renderPlaywrightSpec writes is run by the real
 *      Playwright test runner (Edge, no browser download). It must FAIL against
 *      the shop as it is, and PASS with FRICTION_RUNTIME_PATCH=1. That is the
 *      claim every pull request's test file makes about itself.
 *   2. FRICTION'S OWN RUNNER (prTest.ts, through Stagehand, as in a live run):
 *      the same test is proven; a patch that does nothing is not; a test that
 *      already passes today is not. A test is only ever committed when this
 *      says "proven", so it has to reach Playwright's verdicts.
 *
 * Exits 1 on the first thing that is wrong.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FixTestSchema, renderPlaywrightSpec, validatePatch, type FixTest } from "@friction/shared";
import { demoShopResponse } from "@friction/shared/demo-shop";

// Before config.ts is imported: this check drives a local browser, whatever the .env says.
process.env.BROWSER_ENV = "LOCAL";
const { config } = await import("../src/config");
const { proveFixTest } = await import("../src/prTest");

let failures = 0;
function check(name: string, ok: unknown, detail?: unknown): void {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const page = demoShopResponse(url.pathname, url.search);
  setTimeout(() => {
    res.writeHead(page.status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page.html);
  }, Math.min(page.delayMs, 300));
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const shop = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

/** What a good fix for the dead "Add to cart" looks like: the pattern the proposer's instructions ask for. */
const GENUINE_PATCH = [
  "// Say what is missing when Add to cart is pressed without a size.",
  "try {",
  '  document.addEventListener("click", function (e) {',
  "    try {",
  '      var add = e.target && e.target.closest ? e.target.closest("#add") : null;',
  '      if (!add || document.querySelector("input[name=size]:checked")) return;',
  '      var err = document.getElementById("err");',
  '      if (err) err.textContent = "Please select a size.";',
  '      var first = document.querySelector("input[name=size]");',
  "      if (first) first.focus();",
  "    } catch (inner) {}",
  "  }, true);",
  "} catch (e) {}",
].join("\n");
const INERT_PATCH = "try { void 0; } catch (e) {}";

const sizeTest: FixTest = FixTestSchema.parse({
  title: "Add to cart says a size is needed",
  startPath: "/products/glacier-3-in-1-jacket",
  steps: [{ action: "click", role: "button", name: "Add to cart" }],
  expect: [{ kind: "text_visible", text: "Please select a size" }],
});
/** True today, fix or no fix: a test like this proves nothing and must never ship. */
const trivialTest: FixTest = FixTestSchema.parse({ ...sizeTest, title: "The page has an Add to cart button", steps: [], expect: [{ kind: "role_visible", role: "button", name: "Add to cart" }] });

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workDir = resolve(appDir, ".pr-test-smoke");

/** Asynchronous on purpose: the demo shop is served by THIS process, and a blocking spawn would leave Playwright talking to nobody. */
function playwright(env: Record<string, string>): Promise<{ status: number | null; output: string }> {
  return new Promise((done) => {
    const run = spawn(process.execPath, [resolve(appDir, "node_modules/@playwright/test/cli.js"), "test", "--config", resolve(workDir, "playwright.config.ts")], { cwd: workDir, env: { ...process.env, ...env, CI: "1" } });
    let output = "";
    run.stdout.on("data", (chunk) => (output += String(chunk)));
    run.stderr.on("data", (chunk) => (output += String(chunk)));
    const timer = setTimeout(() => run.kill(), 120_000);
    run.on("close", (status) => {
      clearTimeout(timer);
      done({ status, output });
    });
  });
}

try {
  check("the reference patch is one the validator accepts", validatePatch(GENUINE_PATCH) === null, validatePatch(GENUINE_PATCH));

  console.log("1. The rendered spec, under the real Playwright runner (Edge)");
  mkdirSync(resolve(workDir, "tests/friction"), { recursive: true });
  writeFileSync(resolve(workDir, "playwright.config.ts"), 'export default { testDir: "tests/friction", outputDir: "results", timeout: 30000, expect: { timeout: 5000 }, reporter: "line", retries: 0, use: { channel: "msedge", headless: true } };\n');
  writeFileSync(resolve(workDir, "tests/friction/smoke-f13.spec.ts"), renderPlaywrightSpec({ test: sizeTest, siteUrl: shop, findingId: "f13", summary: 'Clicked "Add to cart" and nothing happened.', patchJs: GENUINE_PATCH }));

  const unfixed = await playwright({ BASE_URL: shop });
  check("it FAILS against the shop as it is", unfixed.status !== 0 && /1 failed/.test(unfixed.output), unfixed.output.slice(-600));
  // The run before this check existed "failed" because the page never loaded. A failure only counts when it is the right one.
  const failedOnTheExpectation = unfixed.output.includes("toBeVisible") && unfixed.output.includes("Error: expect(") && !unfixed.output.includes("page.goto:") && !unfixed.output.includes("locator.click:");
  check("and fails on the expectation (the message never appears), not on reaching the page or the button", failedOnTheExpectation, unfixed.output.slice(-1500));
  const patched = await playwright({ BASE_URL: shop, FRICTION_RUNTIME_PATCH: "1" });
  check("it PASSES with FRICTION_RUNTIME_PATCH=1", patched.status === 0 && /1 passed/.test(patched.output), patched.output.slice(-2500));

  console.log("2. Friction's own runner (Stagehand, as in a live run) reaches the same verdicts");
  const proven = await proveFixTest({ config, siteUrl: shop, test: sizeTest, patchJs: GENUINE_PATCH, findingId: "f13" });
  check("the same test is proven: fails today, passes with the patch", proven.proven, proven.note);
  const inert = await proveFixTest({ config, siteUrl: shop, test: sizeTest, patchJs: INERT_PATCH, findingId: "f13" });
  check("a patch that does nothing proves no test", !inert.proven && /still fails with the verified patch/.test(inert.note), inert.note);
  const trivial = await proveFixTest({ config, siteUrl: shop, test: trivialTest, patchJs: GENUINE_PATCH, findingId: "f13" });
  check("a test that already passes today is thrown away", !trivial.proven && /passes against the site as it is/.test(trivial.note), trivial.note);

  console.log("3. The markup the fix proposer is shown (pageScripts.ts elementHtmlScript), read from a real page");
  const { openBrowser } = await import("../src/browser");
  const { elementHtmlScript } = await import("../src/pageScripts");
  const browser = await openBrowser(config, "primary");
  try {
    await browser.page.goto(`${shop}/products/glacier-3-in-1-jacket`, { waitUntil: "load", timeoutMs: 30_000 });
    const xpath = await browser.page.evaluate<string>(
      '(() => { const parts = []; for (let n = document.getElementById("add"); n && n.nodeType === 1; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++; parts.unshift(n.tagName.toLowerCase() + "[" + i + "]"); } return "/" + parts.join("/"); })()',
    );
    const html = await browser.page.evaluate<{ target: string; overlay: string }>(elementHtmlScript(xpath));
    check("the target's own markup, with the id a patch should select it by", html.target.includes('<button id="add"') && html.target.includes("Add to cart"), html);
    check("inside its ancestors' opening tags, one per line, outermost first", html.target.split("\n").length >= 3 && html.target.split("\n")[0]?.startsWith("<") && !html.target.split("\n")[0]?.includes("</"), html.target);
    check("and no overlay when nothing covers the page", html.overlay === "", html.overlay);
    const missing = await browser.page.evaluate<{ target: string; overlay: string }>(elementHtmlScript("/html[1]/body[1]/nope[1]"));
    check("an element that is gone reads as empty, not as an error", missing.target === "", missing);
  } finally {
    await browser.close().catch(() => undefined);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
  server.close();
}

console.log(failures === 0 ? "OK" : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
