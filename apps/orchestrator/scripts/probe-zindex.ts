/**
 * Does the host page's own overlay paint over the Friction overlay?
 *
 * The demo shop opens a newsletter popup (.veil, z-index 50) on a timer. The
 * Friction root is position:fixed with NO z-index, so it sits at z-index auto
 * in the page's stacking context: every positioned host element with a z-index
 * above 0 wins, no matter what the shadow root's own 2147483000 says.
 *
 * Every page.evaluate here is a STRING, not a function: tsx's esbuild turns
 * keepNames on, which wraps functions in a __name() helper the page does not
 * have (the same reason src/pageScripts.ts is written as strings).
 */
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const overlaySrc = await readFile(resolve(here, "../../../packages/overlay/dist/overlay.iife.js"), "utf8");
const SHOTS = resolve(here, "../../../overlay-shots");
const WORKER = (process.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${WORKER}/demo-shop/products/alpine-down-parka`, { waitUntil: "domcontentloaded" });
await page.evaluate(overlaySrc);
await page.waitForTimeout(1500);

/* The site's popup and cookie bar are on a timer; show them deterministically. */
await page.evaluate(`
  var v = document.getElementById("veil"); if (v) v.removeAttribute("hidden");
  var c = document.getElementById("cookies"); if (c) c.removeAttribute("hidden");
  true
`);
await page.waitForTimeout(300);

const PROBE = `(() => {
  var root = document.getElementById("__friction-root");
  var zOf = function (el) { return el ? getComputedStyle(el).zIndex : "n/a"; };
  var name = function (el) {
    if (!el) return "nothing";
    if (el === root) return "friction-overlay";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).split(" ")[0] : "");
  };
  var panel = root.shadowRoot.querySelector(".panel");
  var r = panel.getBoundingClientRect();
  var veil = document.getElementById("veil");
  var vr = veil.getBoundingClientRect();
  return {
    frictionRootZ: zOf(root),
    markerZinsideShadow: zOf(root.shadowRoot.querySelector(".marker")),
    siteVeilZ: zOf(veil),
    siteCookiesZ: zOf(document.getElementById("cookies")),
    panelBox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    whoIsOnTopAtPanelCentre: name(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
    whoIsOnTopAtVeilCentre: name(document.elementFromPoint(vr.x + vr.width / 2, vr.y + vr.height / 2))
  };
})()`;

console.log("BEFORE any fix:");
console.log(JSON.stringify(await page.evaluate(PROBE), null, 2));
await page.screenshot({ path: resolve(SHOTS, "7-zindex-before.png") });

/* The one-line candidate fix, applied at runtime to confirm it is the whole cause. */
const AFTER = `(() => {
  var root = document.getElementById("__friction-root");
  root.style.zIndex = "2147483647";
  var panel = root.shadowRoot.querySelector(".panel");
  var r = panel.getBoundingClientRect();
  var hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { frictionRootZ: getComputedStyle(root).zIndex, whoIsOnTopAtPanelCentre: hit === root ? "friction-overlay" : hit.tagName.toLowerCase() };
})()`;

console.log("\nAFTER setting a z-index on the root:");
console.log(JSON.stringify(await page.evaluate(AFTER), null, 2));
await page.screenshot({ path: resolve(SHOTS, "8-zindex-after.png") });

await browser.close();
