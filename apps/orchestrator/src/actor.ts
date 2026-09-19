/**
 * ACT + CAPTURE for one step.
 *
 * Target resolution is two-tier. The planner cites an element id from
 * Stagehand's accessibility snapshot; we map it to its XPath and hand
 * Stagehand a ready-made Action, so act() runs deterministically with no model
 * call. If the id is missing or stale we fall back to stagehand.observe(),
 * Stagehand's model-backed element finder.
 *
 * Everything the friction detectors need is measured here, deterministically:
 * how long the page took to settle, whether the DOM or URL changed, whether an
 * overlay or error text appeared, whether focus moved.
 */
import { normalizeUrlForVisit, type ActionType, type Anchor, type BBox, type StepPayload, type StepSignals } from "@friction/shared";
import { cleanLabel, idFromDescription, sameLabelCount } from "./a11y";
import type { BrowserHandle, StagehandPage } from "./browser";
import { VIEWPORT } from "./config";
import { captureEvidence, readState, readTree, type Observation } from "./observe";
import { ARM_ACTION, FOCUS_PROBE, READ_MUTATIONS, locateScript, type FocusProbe, type Located } from "./pageScripts";
import type { PlannedAction } from "./planner";
import { errorMessage, sleep, withTimeout } from "./util";
import type { WorkerClient } from "./workerClient";

const MAX_KEYS_PER_STEP = 12;
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MAX_MS = 3000;

export interface StepOutcome {
  payload: StepPayload;
  /** Counts towards the agent's abandonment threshold. */
  failedAttempt: boolean;
  /** One line for the planner's history, so the agent can react next turn. */
  historyAction: string;
  historyOutcome: string;
  /** The pruned accessibility tree the agent saw before acting. A fix is written against it. */
  treeLines: string[];
}

export interface ActContext {
  browser: BrowserHandle;
  worker: WorkerClient;
  runId: string;
  /** R2 key for this step's evidence screenshot. */
  evidenceKeyFor: (stepNumber: number) => string;
  startUrl: string;
  stepNumber: number;
}

const POINTER_TARGETED: ReadonlySet<ActionType> = new Set<ActionType>(["click", "type", "select"]);

const mutations = (page: StagehandPage) =>
  page
    .evaluate<{ armed: boolean; meaningful: number; outsideOverlay: number; formChanged: boolean; quietMs: number }>(READ_MUTATIONS)
    .catch(() => ({ armed: false, meaningful: 0, outsideOverlay: 0, formChanged: false, quietMs: 99_999 }));

const focusProbe = (page: StagehandPage) =>
  page.evaluate<FocusProbe>(FOCUS_PROBE).catch((): FocusProbe => ({ key: "unknown", label: "", bbox: null, url: page.url() }));

/** Same site as the run started on? Keeps an agent from wandering off across the web. */
function sameSite(startUrl: string, target: string): boolean {
  try {
    const site = (host: string): string => host.split(".").slice(-2).join(".");
    return site(new URL(startUrl).hostname) === site(new URL(target).hostname);
  } catch {
    return false;
  }
}

const STOPWORDS = new Set(["the", "and", "for", "you", "your", "our", "with", "from", "this", "that", "now", "get", "all", "off"]);

/** Crude stems of the meaningful words in a label: "Added to cart" -> {add, cart}. */
function stems(label: string): Set<string> {
  const out = new Set<string>();
  for (const word of label.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    out.add(word.replace(/(ing|ed|es|s)$/, "") || word);
  }
  return out;
}

/** Do a trigger and an overlay look like they belong together? */
export function labelsRelated(trigger: string, overlay: string): boolean {
  const a = stems(trigger);
  if (a.size === 0) return false;
  for (const stem of stems(overlay)) if (a.has(stem)) return true;
  return false;
}

function inViewport(bbox: BBox | null): BBox | null {
  if (!bbox) return null;
  const visible = bbox.x + bbox.w > 0 && bbox.y + bbox.h > 0 && bbox.x < VIEWPORT.w && bbox.y < VIEWPORT.h;
  return visible ? bbox : null;
}

/** Wait for the page to finish reacting: a load if it navigated, otherwise a quiet DOM. */
async function settle(page: StagehandPage, urlBefore: string): Promise<void> {
  await sleep(350);
  if (normalizeUrlForVisit(page.url()) !== normalizeUrlForVisit(urlBefore)) {
    await page.waitForLoadState("load", 12_000).catch(() => undefined);
    await sleep(400);
    return;
  }
  const deadline = Date.now() + SETTLE_MAX_MS;
  while (Date.now() < deadline) {
    const { armed, quietMs } = await mutations(page);
    if (!armed || quietMs > 400) return;
    await sleep(150);
  }
}

export async function performStep(ctx: ActContext, plan: PlannedAction, observation: Observation): Promise<StepOutcome> {
  const { page, stagehand } = ctx.browser;
  // "type" with no target: the agent tabbed into a field itself and types into whatever has focus.
  const intoFocus = plan.actionType === "type" && plan.targetDescription.trim() === "";
  const urlBefore = plan.actionType === "navigate" && observation.state.url === "about:blank" ? (plan.value ?? ctx.startUrl) : observation.state.url;
  // "text\n" means type, then Enter. The payload keeps the text; the Enter is recorded as a key press.
  const submits = plan.actionType === "type" && (plan.value ?? "").endsWith("\n");
  const value = plan.value === null ? undefined : plan.value.replace(/\n$/, "");

  let label = "";
  let selector = "";
  let bbox: BBox | null = null;
  let anchor: Anchor | null = null;
  let evidence = observation.evidence;
  let actionError: string | null = null;
  let opensPopup = false;
  const signals: StepSignals = {};

  /* ---- resolve the target (pointer actions only) ---- */
  let description = plan.targetDescription;
  if (POINTER_TARGETED.has(plan.actionType) && !intoFocus) {
    const node = observation.tree.byId.get(idFromDescription(plan.targetDescription) ?? "");
    if (node?.xpath) {
      selector = `xpath=${node.xpath}`;
      label = cleanLabel(node.name);
    } else {
      // Stale or missing id: let Stagehand's observe() find it from the description.
      try {
        const [found] = await withTimeout(stagehand.observe(`Find: ${plan.targetDescription}`), 30_000, "stagehand.observe");
        if (found) {
          selector = found.selector;
          label = found.description;
          description = found.description;
        }
      } catch (err) {
        actionError = `observe failed: ${errorMessage(err)}`;
      }
    }
    if (selector) {
      const located = await page.evaluate<Located>(locateScript(selector.replace(/^xpath=/, ""))).catch(() => null);
      if (located?.found) {
        bbox = located.bbox;
        label ||= located.label;
        opensPopup = located.opensPopup;
        anchor = located.anchor;
        // The target was off-screen and got scrolled into view: retake, or the bbox would not match the evidence.
        if (located.scrolled) evidence = (await captureEvidence(page)) ?? evidence;
      }
      signals.sameLabelCount = sameLabelCount(observation.tree, label);
    } else {
      actionError ??= `could not find "${plan.targetDescription}" on the page`;
    }
  }

  /* ---- act ---- */
  await page.evaluate(ARM_ACTION).catch(() => undefined);
  const startedAt = Date.now();

  if (!actionError) {
    try {
      switch (plan.actionType) {
        case "click":
          await withTimeout(stagehand.act({ selector, description, method: "click", arguments: [] }), 30_000, "click");
          break;
        case "type":
          if (intoFocus) {
            const focus = await focusProbe(page);
            label = focus.label;
            bbox = focus.bbox;
            await page.type(value ?? "", { delay: 25 });
          } else {
            await withTimeout(stagehand.act({ selector, description, method: "fill", arguments: [value ?? ""] }), 30_000, "type");
            if (submits) {
              await page.keyPress("Enter");
              signals.keysPressed = ["Enter"];
            }
          }
          break;
        case "select":
          await withTimeout(stagehand.act({ selector, description, method: "selectOptionFromDropdown", arguments: [value ?? ""] }), 30_000, "select");
          break;
        case "scroll":
          await page.scroll(VIEWPORT.w / 2, VIEWPORT.h / 2, 0, value === "up" ? -600 : 600);
          break;
        case "navigate": {
          const target = value ?? ctx.startUrl;
          if (!/^https?:\/\//i.test(target) || !sameSite(ctx.startUrl, target)) throw new Error(`refusing to navigate off-site to ${target}`);
          await page.goto(target, { waitUntil: "load", timeoutMs: NAV_TIMEOUT_MS }).catch((err: unknown) => {
            // A slow page is a finding (long_wait), not a crash. Carry on with whatever loaded.
            if (!/timeout|timed out/i.test(errorMessage(err))) throw err;
          });
          break;
        }
        case "wait":
          await sleep(2000);
          break;
        case "press": {
          const keys = (value ?? "").split(/\s+/).filter(Boolean).slice(0, MAX_KEYS_PER_STEP);
          if (keys.length === 0) throw new Error("press needs at least one key");
          signals.keysPressed = [];
          signals.focusMoved = true;
          let activated: FocusProbe | null = null;
          for (const key of keys) {
            const before = await focusProbe(page);
            await page.keyPress(key);
            signals.keysPressed.push(key);
            await sleep(120);
            const after = await focusProbe(page);
            if (/^(enter|space| )$/i.test(key)) activated = before;
            if (after.url !== before.url) break;
            // Tab pressed, focus identical: that is the trap. No point pressing on.
            if (/(^|\+)tab$/i.test(key) && after.key === before.key) {
              signals.focusMoved = false;
              break;
            }
          }
          const final = await focusProbe(page);
          const target = activated ?? final;
          label = target.label;
          bbox = target.bbox;
          signals.focusLabel = final.label;
          signals.sameLabelCount = sameLabelCount(observation.tree, label);
          break;
        }
      }
    } catch (err) {
      actionError = errorMessage(err);
    }
  }

  await settle(page, urlBefore).catch(() => undefined);
  const durationMs = Date.now() - startedAt;

  /* ---- measure what happened ---- */
  const [after, mutated, treeAfter] = await Promise.all([readState(page), mutations(page), readTree(page)]);
  const urlChanged = normalizeUrlForVisit(after.url) !== normalizeUrlForVisit(urlBefore);

  signals.urlAfter = after.url;
  if (actionError) {
    signals.actionFailed = true;
    signals.actionError = actionError;
  }

  const freshErrors = treeAfter.errorTexts.filter((text) => !observation.tree.errorTexts.includes(text));
  if (treeAfter.errorTexts.length > 0) signals.errorTexts = treeAfter.errorTexts;

  // An overlay the agent did not ask for. Popups open on timers, so "it appeared right after my
  // click" proves nothing. It only counts as the agent's own doing when the thing they activated
  // plausibly opens it: it declares a popup, or the two are named alike ("Add to cart" -> "Added to cart").
  const overlayNow = after.overlay?.label ?? treeAfter.dialogLabel;
  const overlayBefore = observation.state.overlay?.label ?? observation.tree.dialogLabel;
  const activates = plan.actionType === "click" || plan.actionType === "select" || (signals.keysPressed ?? []).some((key) => /^(enter|space)$/i.test(key));
  const userInitiated = activates && !urlChanged && (opensPopup || labelsRelated(label, overlayNow ?? ""));
  const interrupted = Boolean(overlayNow && !overlayBefore && !userInitiated);
  if (interrupted) {
    signals.modalAppeared = true;
    signals.modalLabel = overlayNow ?? undefined;
  }

  // Did the page respond to the action? A new URL or a replaced document (armed: false) is a change by
  // definition. formChanged covers ticking a radio or typing: property changes MutationObserver cannot
  // see. And when an unrelated popup interrupted, only changes OUTSIDE it count, or a timed newsletter
  // modal would make a dead button look like it worked.
  const responded = interrupted ? mutated.outsideOverlay > 0 : mutated.meaningful > 0;
  const domChanged =
    !actionError && (urlChanged || !mutated.armed || responded || mutated.formChanged || (plan.actionType === "scroll" && after.scrollY !== observation.state.scrollY));

  // Evidence shows the page BEFORE the action with the target boxed, except when the finding is
  // something that appeared afterwards on the same page: then the "after" shot is the evidence.
  if (!urlChanged && (signals.modalAppeared || freshErrors.length > 0)) {
    evidence = (await captureEvidence(page)) ?? evidence;
  }

  let screenshotKey = "";
  if (evidence) {
    const key = ctx.evidenceKeyFor(ctx.stepNumber);
    if (await ctx.worker.putEvidence(key, evidence, "image/jpeg")) screenshotKey = key;
  }

  const payload: StepPayload = {
    url: urlBefore,
    actionType: plan.actionType,
    targetLabel: label,
    selector,
    rationale: plan.rationale,
    screenshotKey,
    bbox: inViewport(bbox),
    durationMs,
    domChanged,
    ...(value === undefined ? {} : { value }),
    viewport: { w: VIEWPORT.w, h: VIEWPORT.h },
    signals,
    ...(anchor ? { anchor } : {}),
  };

  const deadClick = plan.actionType === "click" && !actionError && !domChanged;
  const what = `${plan.actionType}${label ? ` "${label}"` : ""}${value && plan.actionType !== "click" ? ` (${value})` : ""}`;
  let outcome = urlChanged ? `went to ${after.url}` : domChanged ? "the page changed" : "NO VISIBLE EFFECT: nothing on the page changed";
  // Moving focus IS the effect of a key press; do not tell the agent that nothing happened.
  if (plan.actionType === "press" && !urlChanged && !domChanged) outcome = `focus is now on ${signals.focusLabel ? `"${signals.focusLabel}"` : "the page body"}`;
  if (actionError) outcome = `FAILED: ${actionError}`;
  if (signals.focusMoved === false) outcome = "FOCUS DID NOT MOVE: Tab had no effect";
  if (signals.modalAppeared) outcome += `; a dialog appeared: "${signals.modalLabel}"`;
  if (freshErrors.length > 0) outcome += `; error shown: "${freshErrors[0]}"`;
  if (durationMs > 5000) outcome += `; it took ${(durationMs / 1000).toFixed(1)}s`;

  return {
    payload,
    failedAttempt: Boolean(actionError) || deadClick || signals.focusMoved === false,
    historyAction: what,
    historyOutcome: outcome,
    treeLines: observation.tree.lines,
  };
}
