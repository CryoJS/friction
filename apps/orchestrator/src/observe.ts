/**
 * OBSERVE: what the persona can see right now.
 *   - a viewport screenshot, twice: full size as evidence for R2, and
 *     downscaled in the browser for the model (this is where the token bill is)
 *   - the accessibility tree, pruned to interactive elements plus headings
 *   - page state the detectors need (focus, overlays)
 */
import { summarizeTree, type A11ySummary } from "./a11y";
import type { StagehandPage } from "./browser";
import { ARM_AMBIENT, PAGE_STATE, type PageState } from "./pageScripts";
import { errorMessage, log, withTimeout } from "./util";

/** 1280x720 -> 768x432: legible UI text at a fraction of the image tokens. */
const MODEL_IMAGE_SCALE = 0.6;
const EVIDENCE_QUALITY = 68;
const MODEL_QUALITY = 55;

export interface Observation {
  state: PageState;
  tree: A11ySummary;
  /** Full-size JPEG of the viewport. */
  evidence: Buffer | null;
  /** Base64 JPEG, downscaled, for the planner. */
  forModel: string | null;
}

const EMPTY_TREE: A11ySummary = { lines: [], byId: new Map(), interactive: [], dialogLabel: null, errorTexts: [], truncated: 0 };

export async function readState(page: StagehandPage): Promise<PageState> {
  try {
    return await withTimeout(page.evaluate<PageState>(PAGE_STATE), 8000, "page state");
  } catch {
    // Mid-navigation or a page that blocks evaluation: fall back to what the driver knows.
    return {
      url: page.url(),
      title: "",
      viewport: { w: 1280, h: 720 },
      scrollX: 0,
      scrollY: 0,
      scrollMax: 0,
      focus: { key: "body", label: "", tag: "body", bbox: null },
      overlay: null,
      tabStops: [],
    };
  }
}

export async function readTree(page: StagehandPage): Promise<A11ySummary> {
  try {
    const snapshot = await withTimeout(page.snapshot(), 15_000, "accessibility snapshot");
    return summarizeTree(snapshot.formattedTree, snapshot.xpathMap, snapshot.urlMap);
  } catch (err) {
    log("observe", `accessibility snapshot failed: ${errorMessage(err)}`);
    return EMPTY_TREE;
  }
}

export async function captureEvidence(page: StagehandPage): Promise<Buffer | null> {
  try {
    return await withTimeout(page.screenshot({ type: "jpeg", quality: EVIDENCE_QUALITY, scale: "css" }), 15_000, "screenshot");
  } catch (err) {
    log("observe", `screenshot failed: ${errorMessage(err)}`);
    return null;
  }
}

/**
 * Downscale inside the browser: Page.captureScreenshot takes a clip with a
 * scale factor, so there is no image library to install. The clip is relative
 * to the DOCUMENT, not the viewport, hence the scroll offsets: without them a
 * scrolled persona would be shown the top of the page.
 */
async function captureForModel(page: StagehandPage, state: PageState): Promise<string | null> {
  try {
    const shot = await withTimeout(
      page.sendCDP<{ data: string }>("Page.captureScreenshot", {
        format: "jpeg",
        quality: MODEL_QUALITY,
        clip: { x: state.scrollX, y: state.scrollY, width: state.viewport.w, height: state.viewport.h, scale: MODEL_IMAGE_SCALE },
      }),
      15_000,
      "downscaled screenshot",
    );
    return shot.data;
  } catch (err) {
    log("observe", `downscaled screenshot failed: ${errorMessage(err)}`);
    return null;
  }
}

export async function observe(page: StagehandPage): Promise<Observation> {
  // From now until the action starts, DOM mutations are ambient noise (see pageScripts).
  await page.evaluate(ARM_AMBIENT).catch(() => undefined);
  const state = await readState(page);
  // The two captures MUST NOT overlap. The downscaled one works by temporarily
  // changing the page scale; run concurrently, the full-size evidence comes out
  // shrunk into the top-left corner and every bbox lands in the wrong place.
  const evidence = await captureEvidence(page);
  const forModel = await captureForModel(page, state);
  const tree = await readTree(page);
  return { state, tree, evidence, forModel: forModel ?? evidence?.toString("base64") ?? null };
}
