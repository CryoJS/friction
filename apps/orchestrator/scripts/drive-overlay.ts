/**
 * Clicks the built bookmarklet on the live demo shop and screenshots what a
 * user would see. No stubs: it evaluates packages/overlay/dist/overlay.iife.js
 * -- the same bytes dist/bookmarklet.txt url-encodes -- in a real page, which
 * is exactly what the browser does when the bookmark is clicked.
 *
 *   pnpm --filter @friction/worker dev
 *   pnpm --filter @friction/orchestrator seed:annotations
 *   WORKER_ORIGIN=http://127.0.0.1:8787 pnpm --filter @friction/overlay build
 *   pnpm --filter @friction/orchestrator drive:overlay
 *
 * Screenshots land in the directory given by OUT (default ./overlay-shots).
 */
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(here, "../../../packages/overlay/dist/overlay.iife.js");
const OFFLINE_BUNDLE = resolve(here, "../../../packages/overlay/dist/overlay-offline.iife.js");
const WORKER = (process.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const SHOP = `${WORKER}/demo-shop`;
const OUT = resolve(process.env.OUT ?? join(here, "../../../overlay-shots"));

await mkdir(OUT, { recursive: true });
const overlaySrc = await readFile(BUNDLE, "utf8");
const offlineSrc = await readFile(OFFLINE_BUNDLE, "utf8");

const browser = await chromium.launch({ channel: "msedge", headless: process.env.HEADED !== "1" }).catch(() => chromium.launch({ headless: process.env.HEADED !== "1" }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") console.log(`  [page error] ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 300)}`));

/** Clicking the bookmark == evaluating the bundle in the page. */
const clickBookmarklet = (src: string) => page.evaluate(src);

const shot = async (name: string, fullPage = false): Promise<void> => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log(`  shot  ${file}`);
};

const overlayState = () =>
  page.evaluate(() => {
    const root = document.getElementById("__friction-root");
    const shadow = root?.shadowRoot ?? null;
    if (!shadow) return { mounted: false, markers: 0, panelRows: 0, panelText: "" };
    return {
      mounted: true,
      markers: shadow.querySelectorAll("[class*=marker]").length,
      panelRows: shadow.querySelectorAll("[class*=row]").length,
      panelText: (shadow.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 700),
    };
  });

/* --------------------------------------------------------- 1. the product page */

console.log(`\n1. ${SHOP}/products/alpine-down-parka`);
await page.goto(`${SHOP}/products/alpine-down-parka`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await clickBookmarklet(overlaySrc);
await page.waitForTimeout(1500);
console.log(`  ${JSON.stringify(await overlayState()).slice(0, 600)}`);
await shot("1-product-page");

/* ------------------------------------------------------------- 2. open a card */

const opened = await page.evaluate(() => {
  const shadow = document.getElementById("__friction-root")?.shadowRoot;
  const marker = shadow?.querySelector<HTMLElement>("[class*=marker]");
  if (!marker) return false;
  marker.click();
  return true;
});
console.log(`\n2. clicked the first marker: ${opened}`);
await page.waitForTimeout(900);
await shot("2-card-open");

/* ------------------------------------------- 3. the search page (ordinal tier) */

console.log(`\n3. ${SHOP}/search?q=jacket  (four identical "Select options" buttons)`);
await page.goto(`${SHOP}/search?q=jacket`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await clickBookmarklet(overlaySrc);
await page.waitForTimeout(1500);
const searchState = await overlayState();
console.log(`  ${JSON.stringify(searchState).slice(0, 400)}`);
// Which of the four identical buttons did it pin? ordinal=1 means the second.
const pinnedTo = await page.evaluate(() => {
  const shadow = document.getElementById("__friction-root")?.shadowRoot;
  const marker = shadow?.querySelector<HTMLElement>("[class*=marker]");
  if (!marker) return null;
  const box = marker.getBoundingClientRect();
  const buttons = [...document.querySelectorAll("article.card button")];
  const nearest = buttons
    .map((b, i) => { const r = b.getBoundingClientRect(); return { i, product: b.closest("article")?.querySelector("h3")?.textContent ?? "", d: Math.hypot(r.left - box.left, r.top - box.top) }; })
    .sort((a, b) => a.d - b.d)[0];
  return nearest;
});
console.log(`  marker sits on button index ${pinnedTo?.i} ("${pinnedTo?.product}")  <- anchor ordinal was 1`);
await shot("3-search-ordinal");

/* ------------------------------------------------------------- 4. idempotence */

await clickBookmarklet(overlaySrc);
await page.waitForTimeout(500);
console.log(`\n4. clicked again -> mounted: ${(await overlayState()).mounted}`);

/* -------------------------------------------------- 5. the offline bookmarklet */

console.log(`\n5. offline bookmarklet (no network call)`);
const annotations = await (await fetch(`${WORKER}/api/annotations?host=127.0.0.1`)).json();
await page.goto(`${SHOP}/products/alpine-down-parka`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await page.route("**/api/annotations*", (route) => route.abort());
await page.evaluate(`window.__FRICTION_DATA__=${JSON.stringify(annotations)};${offlineSrc}`);
await page.waitForTimeout(1200);
console.log(`  ${JSON.stringify(await overlayState()).slice(0, 400)}`);
await shot("5-offline");

const offlineHref = `javascript:${encodeURIComponent(`window.__FRICTION_DATA__=${JSON.stringify(annotations)};${offlineSrc}`)}`;
console.log(`  assembled offline javascript: URL is ${offlineHref.length} chars (BookmarkletCard caps at 60000)`);

/* -------------------------------------------------- 6. a host with no scan */

console.log(`\n6. a page whose host has no scan`);
await page.goto("http://localhost:8787/demo-shop/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(300);
await clickBookmarklet(overlaySrc);
await page.waitForTimeout(1500);
console.log(`  ${JSON.stringify(await overlayState()).slice(0, 400)}`);
await shot("6-no-scan");

await writeFile(join(OUT, "annotations.json"), JSON.stringify(annotations, null, 2));
await browser.close();
console.log(`\ndone -> ${OUT}`);
