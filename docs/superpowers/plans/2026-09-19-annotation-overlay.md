# Annotation Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a bookmarklet that draws a completed scan's findings onto the user's own live site, pinned to the real elements.

**Architecture:** A richer `Anchor` is captured at scan time while the element is still in hand, and rides along on payloads that already exist. A new dependency-free `packages/overlay` resolves each anchor against the live DOM through a confidence-ranked ladder, then renders markers and a panel inside a shadow root. A CORS-scoped `GET /api/annotations` on the Worker serves the findings. Nothing about the agent loop, the detectors, or the fix proposer changes.

**Tech Stack:** TypeScript 7, zod 4, Hono 4 (Worker, D1), esbuild (overlay bundle), vitest + happy-dom (overlay and shared tests), `node --test --import tsx` (orchestrator tests), React 19 + Tailwind 4 (control room).

**Spec:** `docs/superpowers/specs/2026-09-19-annotation-overlay-design.md`

## Global Constraints

- **Phase 1 only.** Do not touch, delete, or refactor the `verify` lane. `verify.ts`, `judgeVerification`, `FixReport`'s stage machine, `LanePane`, `FixComparison` and `RoomComparison` all keep working exactly as they do now. Retiring the lane is phase 2 and has its own spec.
- **`anchor` is optional everywhere.** Scans recorded before this change must still parse. A finding without an anchor resolves as `unlocated` — that is a normal outcome, never an error.
- **The overlay has zero runtime dependencies.** No framework, no helper library. It ships inside a `javascript:` URL and the whole bundle must stay under **25 KB** URL-encoded.
- **Global CORS stays restricted.** `isAllowedOrigin` in `packages/shared/src/util.ts` is not to be widened. `Access-Control-Allow-Origin: *` appears on `/api/annotations` and nowhere else.
- **Page-context scripts in `apps/orchestrator/src/pageScripts.ts` stay strings.** tsx's esbuild `keepNames` wraps functions in a `__name()` helper that does not exist in the remote page. `packages/overlay` has its own esbuild config with `keepNames: false` and is written as normal TypeScript modules.
- **Test runners differ per package.** `packages/shared` and `packages/overlay` use `vitest`. `apps/orchestrator` and `apps/control-room` use `node --test --import tsx`. Use whichever the package already declares.
- Branch: `feat/annotation-overlay`, already created.

---

### Task 1: The Anchor type and its pure helpers

**Files:**
- Create: `packages/shared/src/anchor.ts`
- Create: `packages/shared/src/anchor.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Anchor`, `AnchorSchema`, `ANCHOR_ATTRS`, `MAX_DATA_ATTRS`, `normalizeHost(input: string): string`, `OVERLAY_VERSION: number`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/anchor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AnchorSchema, normalizeHost, type Anchor } from "./anchor";

const anchor: Anchor = {
  xpath: "/html/body/main/form/button",
  tag: "button",
  role: "button",
  name: "Add to cart",
  text: "Add to cart",
  attrs: { id: "add-to-cart" },
  ordinal: 0,
  path: "/products/hat",
};

describe("normalizeHost", () => {
  it("lowercases, strips www. and drops the port", () => {
    expect(normalizeHost("https://www.Example.com/products?x=1")).toBe("example.com");
    expect(normalizeHost("EXAMPLE.com:8080")).toBe("example.com");
    expect(normalizeHost("shop.example.co.uk")).toBe("shop.example.co.uk");
  });

  it("returns an empty string for junk rather than throwing", () => {
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost("   ")).toBe("");
    expect(normalizeHost("not a host")).toBe("");
  });

  it("keeps localhost usable", () => {
    expect(normalizeHost("http://localhost:5173/")).toBe("localhost");
  });
});

describe("AnchorSchema", () => {
  it("accepts a well-formed anchor", () => {
    expect(AnchorSchema.parse(anchor)).toEqual(anchor);
  });

  it("rejects a negative ordinal", () => {
    expect(AnchorSchema.safeParse({ ...anchor, ordinal: -1 }).success).toBe(false);
  });

  it("truncating producers are the page script's job, so long text is rejected here", () => {
    expect(AnchorSchema.safeParse({ ...anchor, text: "x".repeat(91) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @friction/shared test`
Expected: FAIL — `Cannot find module './anchor'`

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/anchor.ts`:

```ts
/**
 * How a finding describes the element it happened on, so the annotation
 * overlay can find that element again on a later page load.
 *
 * The existing `selector` is an absolute XPath. That is enough to click
 * something mid-run and not enough to find it again days later: it encodes
 * structure, and structure is the least stable thing about a page. An Anchor
 * records identity as well, so resolution can fall back when the tree moves.
 *
 * `class` is deliberately absent. Utility CSS makes class names
 * non-distinctive and CSS-module hashing makes them change every build, so as
 * an identity signal they are worse than nothing.
 */
import { z } from "zod";

/**
 * Attributes recorded verbatim, in preference order. Interpolated into the
 * page script in apps/orchestrator/src/pageScripts.ts, so this array is the
 * single source of truth for both sides.
 */
export const ANCHOR_ATTRS = ["id", "data-testid", "data-test", "data-cy", "data-qa", "name", "type", "aria-label"] as const;

/** Extra `data-*` attributes kept beyond the named ones, to bound the payload. */
export const MAX_DATA_ATTRS = 4;

/** Longest accessible name and visible text an anchor stores. */
export const ANCHOR_NAME_MAX = 200;
export const ANCHOR_TEXT_MAX = 90;

export const AnchorSchema = z.object({
  /** Absolute XPath. Used, but never trusted on its own. */
  xpath: z.string(),
  /** "button" */
  tag: z.string(),
  /** Explicit role attribute, or the implicit role for the tag. */
  role: z.string(),
  /** Accessible name. */
  name: z.string().max(ANCHOR_NAME_MAX),
  /** Cleaned innerText. */
  text: z.string().max(ANCHOR_TEXT_MAX),
  attrs: z.record(z.string(), z.string()),
  /** Index among elements matching role + name on the page at capture time. */
  ordinal: z.number().int().nonnegative(),
  /** location.pathname when captured. */
  path: z.string(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

/**
 * Bumped whenever the overlay's rendering or resolution changes. Served with
 * every annotations response so a panel drawn by an older bookmarklet can tell
 * the user to re-drag it.
 */
export const OVERLAY_VERSION = 1;

/**
 * A URL or bare host reduced to the form the annotations endpoint matches on:
 * lowercase, no leading "www.", no port. Junk returns "" rather than throwing,
 * because the caller is a query parameter handler, not a parser.
 */
export function normalizeHost(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add after the `export * from "./events";` line:

```ts
export * from "./anchor";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @friction/shared test`
Expected: PASS, all cases in `anchor.test.ts`

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/anchor.ts packages/shared/src/anchor.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): Anchor type, schema and host normalization"
```

---

### Task 2: Carry the anchor on the event payloads

**Files:**
- Modify: `packages/shared/src/events.ts` (`StepPayloadSchema`, `FrictionPayloadSchema`)
- Modify: `packages/shared/src/contracts.test.ts`

**Interfaces:**
- Consumes: `AnchorSchema` from Task 1.
- Produces: `StepPayload.anchor?: Anchor`, `FrictionPayload.anchor?: Anchor`.

`anchor.ts` imports nothing from `events.ts`, so this import introduces no cycle.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/contracts.test.ts`:

```ts
describe("anchor on payloads", () => {
  const anchor = {
    xpath: "/html/body/button",
    tag: "button",
    role: "button",
    name: "Add to cart",
    text: "Add to cart",
    attrs: { id: "add-to-cart" },
    ordinal: 0,
    path: "/products/hat",
  };

  const step = {
    url: "https://example.com/products/hat",
    actionType: "click" as const,
    targetLabel: "Add to cart",
    selector: "xpath=/html/body/button",
    rationale: "I'm adding the hat to the cart.",
    screenshotKey: "runs/r_1/primary/3.jpg",
    bbox: null,
    durationMs: 120,
    domChanged: false,
  };

  it("accepts a step payload with an anchor", () => {
    expect(StepPayloadSchema.parse({ ...step, anchor }).anchor).toEqual(anchor);
  });

  it("still accepts a step payload recorded before anchors existed", () => {
    expect(StepPayloadSchema.parse(step).anchor).toBeUndefined();
  });

  it("accepts a friction payload with an anchor, and without", () => {
    const friction = { category: "dead_click" as const, severity: 3 as const, evidenceSeq: 3, recommendation: "Make the button do something.", confidence: 0.9 };
    expect(FrictionPayloadSchema.parse({ ...friction, anchor }).anchor).toEqual(anchor);
    expect(FrictionPayloadSchema.parse(friction).anchor).toBeUndefined();
  });
});
```

Add `StepPayloadSchema` and `FrictionPayloadSchema` to that file's existing import from `./events` if they are not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @friction/shared test`
Expected: FAIL — the anchor cases fail because zod strips the unknown key, so `.anchor` is `undefined` where the test expects the object

- [ ] **Step 3: Add the field to both schemas**

In `packages/shared/src/events.ts`, add to the import block at the top:

```ts
import { AnchorSchema } from "./anchor";
```

In `StepPayloadSchema`, after the `signals` line:

```ts
  /** extension: how to find this element again later (the annotation overlay) */
  anchor: AnchorSchema.optional(),
```

In `FrictionPayloadSchema`, after the `lastSeq` line:

```ts
  /** extension: the evidence step's anchor, copied here so the overlay needs one payload */
  anchor: AnchorSchema.optional(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @friction/shared test`
Expected: PASS, including every pre-existing contract test

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/events.ts packages/shared/src/contracts.test.ts
git commit -m "feat(shared): optional anchor on step and friction payloads"
```

---

### Task 3: Capture the anchor in the page

**Files:**
- Modify: `apps/orchestrator/src/pageScripts.ts` (`Located` interface, `locateScript`)
- Modify: `apps/orchestrator/src/actor.ts` (around lines 148–158, and where `StepPayload` is built)
- Modify: `apps/orchestrator/scripts/smoke-local.ts`

**Interfaces:**
- Consumes: `Anchor`, `ANCHOR_ATTRS`, `MAX_DATA_ATTRS`, `ANCHOR_TEXT_MAX` from Task 1; `StepPayload.anchor` from Task 2.
- Produces: `Located.anchor: Anchor | null`; a `StepPayload` whose `anchor` is populated for pointer-targeted actions.

`locateScript` stays a template string — see Global Constraints.

- [ ] **Step 1: Extend the `Located` interface**

In `apps/orchestrator/src/pageScripts.ts`, add to the `Located` interface:

```ts
  /** How to find this element again later. Null when the element was not found. */
  anchor: Anchor | null;
```

and add to that file's imports:

```ts
import { ANCHOR_ATTRS, ANCHOR_TEXT_MAX, MAX_DATA_ATTRS, type Anchor } from "@friction/shared";
```

- [ ] **Step 2: Add role and anchor helpers to `HELPERS`**

In `pageScripts.ts`, inside the `HELPERS` template, immediately before the `const st = { v: 5, ... }` line, add:

```js
  const IMPLICIT_ROLES = { a: "link", button: "button", select: "combobox", textarea: "textbox", summary: "button", form: "form", nav: "navigation", main: "main", h1: "heading", h2: "heading", h3: "heading" };
  const roleOf = (el) => {
    const explicit = el.getAttribute && el.getAttribute("role");
    if (explicit) return explicit.trim().split(/\\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (tag === "input") { const t = (el.getAttribute("type") || "text").toLowerCase(); return t === "checkbox" || t === "radio" ? t : t === "button" || t === "submit" || t === "reset" ? "button" : "textbox"; }
    return IMPLICIT_ROLES[tag] || "generic";
  };
```

Then bump the version guard and the state object in the same file: change `if (w.__fr && w.__fr.v === 5) return;` to `=== 6`, and `const st = { v: 5,` to `const st = { v: 6,`, adding `roleOf` to the object literal alongside `labelOf`.

- [ ] **Step 3: Build the anchor inside `locateScript`**

Replace the body of `locateScript` in `pageScripts.ts` with:

```ts
export function locateScript(xpath: string): string {
  return `${HELPERS} (() => {
    const st = window.__fr; const el = st.byXPath(${JSON.stringify(xpath)});
    if (!el || el.nodeType !== 1) return { found: false, label: "", bbox: null, scrolled: false, opensPopup: false, anchor: null };
    let r = el.getBoundingClientRect(); let scrolled = false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) { el.scrollIntoView({ block: "center", inline: "center" }); scrolled = true; r = el.getBoundingClientRect(); }
    const opensPopup = el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-controls") || el.hasAttribute("aria-expanded") || el.tagName === "SUMMARY";

    const role = st.roleOf(el);
    const name = st.labelOf(el);
    const attrs = {};
    for (const key of ${JSON.stringify(ANCHOR_ATTRS)}) { const v = el.getAttribute(key); if (v) attrs[key] = String(v).slice(0, 120); }
    let extra = 0;
    for (const a of el.attributes) { if (extra >= ${MAX_DATA_ATTRS}) break; if (a.name.indexOf("data-") === 0 && !(a.name in attrs)) { attrs[a.name] = String(a.value).slice(0, 120); extra++; } }
    const href = el.tagName === "A" && el.href ? (() => { try { return new URL(el.href).pathname; } catch (e) { return ""; } })() : "";
    if (href) attrs.href = href;
    // Which of the same-role, same-name elements this one is: the only thing that tells twelve "Add to cart" buttons apart.
    let ordinal = 0;
    for (const other of document.querySelectorAll(el.tagName)) { if (other === el) break; if (st.roleOf(other) === role && st.labelOf(other) === name) ordinal++; }

    return { found: true, label: name, bbox: r.width > 0 && r.height > 0 ? st.rectOf(el) : null, scrolled, opensPopup,
      anchor: { xpath: ${JSON.stringify(xpath)}, tag: el.tagName.toLowerCase(), role, name: name.slice(0, 200), text: st.clean(el.innerText).slice(0, ${ANCHOR_TEXT_MAX}), attrs, ordinal, path: location.pathname } };
  })()`;
}
```

- [ ] **Step 4: Thread it through `actor.ts`**

In `apps/orchestrator/src/actor.ts`, add `let anchor: Anchor | null = null;` beside the existing `let bbox: BBox | null = null;` declaration, and add to the imports:

```ts
import type { Anchor } from "@friction/shared";
```

Then inside `if (located?.found) { ... }`, add:

```ts
        anchor = located.anchor;
```

Finally, where the function builds its returned `StepPayload`, add `...(anchor ? { anchor } : {})` to the payload object. Spread conditionally rather than assigning `undefined`, so a payload without an anchor serializes without the key.

- [ ] **Step 5: Assert it in the smoke test**

In `apps/orchestrator/scripts/smoke-local.ts`, in the section commented `/* ---- assert on what the detectors saw ---- */`, add:

```ts
const clicked = events.find((e) => e.type === "step" && e.payload.actionType === "click" && e.payload.selector !== "");
const capturedAnchor = clicked?.type === "step" ? clicked.payload.anchor : undefined;
if (!capturedAnchor) throw new Error("no anchor was captured on a targeted click");
if (!capturedAnchor.role || !capturedAnchor.tag) throw new Error(`anchor is missing role/tag: ${JSON.stringify(capturedAnchor)}`);
console.log(`anchor ok: ${capturedAnchor.tag}[role=${capturedAnchor.role}] "${capturedAnchor.name}" ordinal=${capturedAnchor.ordinal}`);
```

- [ ] **Step 6: Typecheck and run the smoke test against a real browser**

Run: `pnpm typecheck`
Expected: no errors

Run: `pnpm --filter @friction/orchestrator smoke`
Expected: the run completes and prints the `anchor ok:` line. This is the only real-browser check that the page script's anchor branch executes; a syntax error in the template string surfaces here and nowhere else.

- [ ] **Step 7: Commit**

```bash
git add apps/orchestrator/src/pageScripts.ts apps/orchestrator/src/actor.ts apps/orchestrator/scripts/smoke-local.ts
git commit -m "feat(orchestrator): capture an element anchor at locate time"
```

---

### Task 4: Copy the anchor onto findings

**Files:**
- Modify: `apps/orchestrator/src/emitter.ts` (the private `friction()` method, around lines 106–110)

**Interfaces:**
- Consumes: `FrictionPayload.anchor` from Task 2; `StepPayload.anchor` from Task 3.
- Produces: emitted friction events whose payload carries the anchor of their evidence step.

The emitter already holds every event it emitted in `this.events`, so the anchor is looked up from the evidence step rather than plumbed through `friction.ts`. `FrictionCandidate` and the detectors are untouched.

- [ ] **Step 1: Look up the evidence step's anchor**

In `apps/orchestrator/src/emitter.ts`, inside the private `friction()` method, replace the line that assigns `finding.payload` with:

```ts
    // The overlay needs one payload, so the evidence step's anchor is copied onto the finding.
    const evidence = this.events.find((e) => e.type === "step" && e.seq === payload.evidenceSeq);
    const anchor = evidence?.type === "step" ? evidence.payload.anchor : undefined;
    finding.payload = { ...payload, findingId: finding.findingId, ...(anchor ? { anchor } : {}) };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 3: Verify end to end against a real browser**

Run: `pnpm --filter @friction/orchestrator smoke`
Expected: the run completes. Add a temporary `console.log` of the first friction payload if you want to eyeball the anchor; remove it before committing.

- [ ] **Step 4: Commit**

```bash
git add apps/orchestrator/src/emitter.ts
git commit -m "feat(orchestrator): carry the evidence step's anchor onto findings"
```

---

### Task 5: The annotations contract and its pure logic

**Files:**
- Create: `packages/shared/src/annotations.ts`
- Create: `packages/shared/src/annotations.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Anchor`, `normalizeHost`, `OVERLAY_VERSION` from Task 1; `FrictionCategory`, `Severity` from `./events`; `ScanFindingInput` from `./scanReport`; `StepEvent` from `./events`.
- Produces: `AnnotationFinding`, `AnnotationsResponse`, `parseAnnotationsQuery(params)`, `toAnnotationFinding(finding, step, evidenceBase)`.

The Worker has no test harness and this plan does not add one. Following the codebase's existing split — pure logic in `packages/shared`, I/O in the app — everything decidable without D1 lives here and is tested with vitest. Task 7's route is thin glue over these two functions.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/annotations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAnnotationsQuery, toAnnotationFinding } from "./annotations";
import type { StepEvent } from "./events";

describe("parseAnnotationsQuery", () => {
  it("normalizes a host", () => {
    expect(parseAnnotationsQuery({ host: "https://www.Example.com/x" })).toEqual({ ok: true, by: "host", value: "example.com" });
  });

  it("passes a token through untouched", () => {
    expect(parseAnnotationsQuery({ token: "s_abc1234567" })).toEqual({ ok: true, by: "token", value: "s_abc1234567" });
  });

  it("rejects both at once", () => {
    const result = parseAnnotationsQuery({ host: "example.com", token: "s_abc1234567" });
    expect(result.ok).toBe(false);
  });

  it("rejects neither", () => {
    expect(parseAnnotationsQuery({}).ok).toBe(false);
  });

  it("rejects a host that does not normalize", () => {
    expect(parseAnnotationsQuery({ host: "not a host" }).ok).toBe(false);
  });
});

describe("toAnnotationFinding", () => {
  const anchor = { xpath: "/html/body/button", tag: "button", role: "button", name: "Add to cart", text: "Add to cart", attrs: {}, ordinal: 0, path: "/p" };
  const step = {
    runId: "r_1", lane: "primary", seq: 3, ts: 1, type: "step",
    payload: { url: "https://example.com/p", actionType: "click", targetLabel: "Add to cart", selector: "xpath=/html/body/button", rationale: "r", screenshotKey: "runs/r_1/primary/3.jpg", bbox: null, durationMs: 1, domChanged: false, anchor },
  } as StepEvent;
  const finding = {
    id: "f3", findingKey: "dead_click|x", runId: "r_1", category: "dead_click" as const, severity: 3 as const,
    evidenceSeq: 3, recommendation: "Make it do something.", confidence: 0.9, summary: "Nothing happened.",
    whyItMatters: "The visitor cannot buy.", hitCount: 2, selector: "xpath=/html/body/button",
  };

  it("takes the anchor and an absolute evidence URL from the step", () => {
    const result = toAnnotationFinding(finding, step, "https://worker.example/api/evidence");
    expect(result.anchor).toEqual(anchor);
    expect(result.evidenceUrl).toBe("https://worker.example/api/evidence/runs/r_1/primary/3.jpg");
    expect(result.url).toBe("https://example.com/p");
    expect(result.hitCount).toBe(2);
  });

  it("degrades to a null anchor when the step predates anchors", () => {
    const older = { ...step, payload: { ...step.payload, anchor: undefined } } as StepEvent;
    expect(toAnnotationFinding(finding, older, "https://worker.example/api/evidence").anchor).toBeNull();
  });

  it("degrades to a null anchor and empty url when the evidence step is missing entirely", () => {
    const result = toAnnotationFinding(finding, undefined, "https://worker.example/api/evidence");
    expect(result.anchor).toBeNull();
    expect(result.evidenceUrl).toBeNull();
    expect(result.url).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @friction/shared test`
Expected: FAIL — `Cannot find module './annotations'`

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/annotations.ts`:

```ts
/**
 * GET /api/annotations: what the bookmarklet overlay is served.
 *
 * Pure, like report.ts and scanReport.ts. The Worker does the D1 reads and
 * calls these; everything decidable without a database is tested here.
 *
 * This flattens what assembleScanReport already works from. It is a second
 * SHAPE of the findings, never a second source of truth for them.
 */
import { normalizeHost, OVERLAY_VERSION, type Anchor } from "./anchor";
import type { FrictionCategory, Severity, StepEvent } from "./events";
import type { ScanFindingInput } from "./scanReport";

export { OVERLAY_VERSION };

/** One deduplicated finding, flattened for the overlay. */
export interface AnnotationFinding {
  findingId: string;
  category: FrictionCategory;
  severity: Severity;
  summary: string;
  whyItMatters: string;
  recommendation: string;
  /** The page the finding happened on. Groups the panel. "" when unknown. */
  url: string;
  /** Null for scans recorded before anchors existed: the overlay lists it as unlocated. */
  anchor: Anchor | null;
  /** Absolute URL of the evidence screenshot, or null when none was captured. */
  evidenceUrl: string | null;
  /** The proposed fix. Advisory only: nothing executes it. Null when none was produced. */
  patchJs: string | null;
  hitCount: number;
}

export interface AnnotationsResponse {
  scanId: string;
  scannedAt: number;
  url: string;
  /** Lets the panel tell the user their bookmarklet is out of date. */
  overlayVersion: number;
  findings: AnnotationFinding[];
}

export type AnnotationsQuery =
  | { ok: true; by: "host" | "token"; value: string }
  | { ok: false; error: string };

/**
 * Exactly one of host or token. Both, neither, or a host that does not
 * normalize is a 400: guessing which the caller meant would silently serve
 * the wrong scan.
 */
export function parseAnnotationsQuery(params: { host?: string | null; token?: string | null }): AnnotationsQuery {
  const host = params.host?.trim() ?? "";
  const token = params.token?.trim() ?? "";
  if (host && token) return { ok: false, error: "give either host or token, not both" };
  if (!host && !token) return { ok: false, error: "host or token is required" };
  if (token) return { ok: true, by: "token", value: token };
  const normalized = normalizeHost(host);
  if (!normalized) return { ok: false, error: `host "${host}" is not a hostname` };
  return { ok: true, by: "host", value: normalized };
}

/**
 * One D1 finding row plus its evidence step, in the overlay's shape. A missing
 * step or a missing anchor is normal (older scans, failed captures), never an
 * error: the finding is still worth listing, it just cannot be pinned.
 */
export function toAnnotationFinding(
  finding: ScanFindingInput,
  step: StepEvent | undefined,
  evidenceBase: string,
  patchJs: string | null = null,
): AnnotationFinding {
  const payload = step?.payload;
  const key = payload?.screenshotKey ?? "";
  return {
    findingId: finding.id,
    category: finding.category,
    severity: finding.severity,
    summary: finding.summary ?? "",
    whyItMatters: finding.whyItMatters ?? "",
    recommendation: finding.recommendation,
    url: payload?.signals?.urlAfter ?? payload?.url ?? "",
    anchor: payload?.anchor ?? null,
    evidenceUrl: key ? `${evidenceBase.replace(/\/$/, "")}/${key}` : null,
    patchJs,
    hitCount: finding.hitCount,
  };
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add:

```ts
export * from "./annotations";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @friction/shared test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/annotations.ts packages/shared/src/annotations.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): annotations contract and its pure query/mapping logic"
```

---

### Task 6: Look up a scan by host

**Files:**
- Create: `apps/worker/migrations/0006_scan_host.sql`
- Modify: `apps/worker/src/db.ts` (the `MIGRATIONS` array and its imports)
- Modify: `apps/worker/src/scanDb.ts` (`createScan`, plus a new `getLatestScanByHost`)

**Interfaces:**
- Consumes: `normalizeHost` from Task 1.
- Produces: `getLatestScanByHost(db: D1Database, host: string): Promise<ScanRecord | null>`.

- [ ] **Step 1: Write the migration**

Create `apps/worker/migrations/0006_scan_host.sql`:

```sql
-- The annotations endpoint answers "is there a scan for this hostname?", and
-- SQLite cannot parse a URL, so the normalized host is stored alongside it.
-- Existing rows are backfilled in JS by ensureSchema (src/db.ts): the value
-- comes from normalizeHost(), which has no SQL equivalent.

ALTER TABLE scans ADD COLUMN host TEXT;

CREATE INDEX IF NOT EXISTS idx_scans_host ON scans(host, created_at);
```

`ALTER TABLE` is not idempotent, unlike the other migrations in this directory. That is why Step 2's `applied` predicate inspects the column list rather than the table's existence.

- [ ] **Step 2: Register it with a column-aware predicate**

In `apps/worker/src/db.ts`, add to the imports beside the other `.sql` imports:

```ts
import scanHostSql from "../migrations/0006_scan_host.sql";
```

Add to the `MIGRATIONS` array, after the `0005_task_pull_requests.sql` entry:

```ts
  {
    name: "0006_scan_host.sql",
    sql: scanHostSql,
    // ALTER TABLE is not idempotent, so ask the column list, not the table list.
    applied: async (db) => {
      const ddl = await tableSql(db, "scans");
      return ddl !== null && /\bhost\b/.test(ddl.sql);
    },
  },
```

- [ ] **Step 3: Backfill existing rows**

In `apps/worker/src/db.ts`, at the end of `ensureSchema`, after the migration loop, add:

```ts
  // One-off: rows written before 0006 have a null host, and only JS can parse a URL.
  const stale = await db.prepare("SELECT id, url FROM scans WHERE host IS NULL LIMIT 500").all<{ id: string; url: string }>();
  if (stale.results.length > 0) {
    await db.batch(stale.results.map((row) => db.prepare("UPDATE scans SET host = ? WHERE id = ?").bind(normalizeHost(row.url), row.id)));
  }
```

and add `normalizeHost` to that file's `@friction/shared` import.

- [ ] **Step 4: Populate it on insert**

In `apps/worker/src/scanDb.ts`, find the `INSERT INTO scans` statement in `createScan` and add `host` to its column list and `?` to its values, binding `normalizeHost(url)` in the same position. Add `normalizeHost` to that file's `@friction/shared` import.

- [ ] **Step 5: Add the lookup**

Append to `apps/worker/src/scanDb.ts`:

```ts
/** The newest completed scan for a normalized host, or null. The annotations endpoint's only query. */
export async function getLatestScanByHost(db: D1Database, host: string): Promise<ScanRecord | null> {
  const row = await db
    .prepare("SELECT id FROM scans WHERE host = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1")
    .bind(host)
    .first<{ id: string }>();
  return row ? getScan(db, row.id) : null;
}
```

- [ ] **Step 6: Apply the migration locally and verify**

Run: `pnpm db:migrate:local`
Expected: `0006_scan_host.sql` applies without error

Run: `pnpm --filter @friction/worker dev` in one terminal, then in another:

```bash
curl -s localhost:8787/api/health
```

Expected: `{"ok":true,...}` — confirms `ensureSchema` ran the migration and the backfill without throwing.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no errors

```bash
git add apps/worker/migrations/0006_scan_host.sql apps/worker/src/db.ts apps/worker/src/scanDb.ts
git commit -m "feat(worker): store a normalized host on scans and look one up"
```

---

### Task 7: The annotations endpoint

**Files:**
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `parseAnnotationsQuery`, `toAnnotationFinding`, `AnnotationsResponse`, `OVERLAY_VERSION` from Task 5; `getLatestScanByHost` from Task 6; the existing `getScan` and `getScanFindingRows`.
- Produces: `GET /api/annotations`.

The route is thin: every decision it makes was tested in Task 5.

- [ ] **Step 1: Register the route with its own CORS**

In `apps/worker/src/index.ts`, add the new names to the existing imports, then add this route immediately **before** the `/* ---------------------------------------------------------------- evidence */` comment:

```ts
/**
 * The annotation overlay's only endpoint, called by a bookmarklet running on
 * the user's OWN site, so it is the one route with an open CORS policy. The
 * global policy in isAllowedOrigin() stays restricted: widening it would open
 * every mutating route on this Worker.
 */
app.use("/api/annotations", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], allowHeaders: ["Content-Type"], maxAge: 3600 }));

app.get("/api/annotations", async (c) => {
  const query = parseAnnotationsQuery({ host: c.req.query("host"), token: c.req.query("token") });
  if (!query.ok) return c.json({ error: query.error }, 400);

  const scan = query.by === "token" ? await getScan(c.env.DB, query.value) : await getLatestScanByHost(c.env.DB, query.value);
  if (!scan) return c.json({ error: `no completed Friction scan for ${query.value}` }, 404);

  const rows = await getScanFindingRows(c.env.DB, scan.id);
  const steps = new Map(rows.evidence.map((e) => [`${e.runId}:${e.seq}`, e]));
  const evidenceBase = new URL("/api/evidence", c.req.url).toString();

  const body: AnnotationsResponse = {
    scanId: scan.id,
    scannedAt: scan.completedAt ?? scan.createdAt,
    url: scan.url,
    overlayVersion: OVERLAY_VERSION,
    findings: rows.findings.map((f) => toAnnotationFinding(f, steps.get(`${f.runId}:${f.evidenceSeq}`), evidenceBase)),
  };
  return c.json(body);
});
```

- [ ] **Step 2: Verify the happy path and both failure paths**

Run: `pnpm --filter @friction/worker dev`, then in another terminal:

```bash
curl -s "localhost:8787/api/annotations"                                   # 400, "host or token is required"
curl -s "localhost:8787/api/annotations?host=example.com&token=s_x"        # 400, "not both"
curl -s "localhost:8787/api/annotations?host=nosuchsite.example"           # 404
```

Expected: exactly those three, with the messages from Task 5.

- [ ] **Step 3: Verify the CORS scoping — both directions**

```bash
curl -si "localhost:8787/api/annotations?host=example.com" -H "Origin: https://evil.test" | grep -i access-control-allow-origin
curl -si "localhost:8787/api/runs" -H "Origin: https://evil.test" | grep -i access-control-allow-origin
```

Expected: the first prints `access-control-allow-origin: *`. **The second prints nothing.** If the second prints a header, the global policy has been widened and the change is wrong — fix it before committing.

- [ ] **Step 4: Verify against a real scan**

Run a scan through the control room against the bundled demo shop, wait for `completed`, then:

```bash
curl -s "localhost:8787/api/annotations?host=localhost" | head -c 2000
```

Expected: a body with `scanId`, `overlayVersion: 1`, and findings carrying non-null `anchor` objects. If every anchor is null, Tasks 3 and 4 are not wired up — stop and fix that first, because Task 8 onwards has nothing to resolve.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): GET /api/annotations with route-scoped open CORS"
```

---

### Task 8: The overlay package and the resolution ladder

**Files:**
- Create: `packages/overlay/package.json`
- Create: `packages/overlay/tsconfig.json`
- Create: `packages/overlay/vitest.config.ts`
- Create: `packages/overlay/src/resolve.ts`
- Create: `packages/overlay/src/resolve.test.ts`

**Interfaces:**
- Consumes: `Anchor` from Task 1.
- Produces: `Confidence`, `Resolution`, `resolveAnchor(anchor: Anchor, doc: Document): Resolution`, `roleOf(el: Element): string`, `accessibleName(el: Element): string`.

This is the task that decides whether the feature works. The ladder's tier 2 must **reject** an XPath that now points at a different element — that is the difference between a useful overlay and one that confidently mislabels things.

- [ ] **Step 1: Scaffold the package**

Create `packages/overlay/package.json`:

```json
{
  "name": "@friction/overlay",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@friction/shared": "workspace:*"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "happy-dom": "^20.0.0",
    "typescript": "^7.0.2",
    "vitest": "^5.0.1"
  }
}
```

Create `packages/overlay/tsconfig.json`, copying `packages/shared/tsconfig.json` verbatim and adjusting any relative paths it contains.

Create `packages/overlay/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "happy-dom" } });
```

Run: `pnpm install`
Expected: the workspace picks up `packages/overlay` via the existing `packages/*` glob in `pnpm-workspace.yaml`.

- [ ] **Step 2: Write the failing test**

Create `packages/overlay/src/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Anchor } from "@friction/shared";
import { resolveAnchor } from "./resolve";

const base: Anchor = {
  xpath: "/html/body/main/form/button",
  tag: "button",
  role: "button",
  name: "Add to cart",
  text: "Add to cart",
  attrs: {},
  ordinal: 0,
  path: "/products/hat",
};

function load(html: string): Document {
  document.documentElement.innerHTML = html;
  return document;
}

describe("resolveAnchor", () => {
  it("tier 1: finds by a stable id and calls it exact", () => {
    const doc = load(`<body><main><form><button id="add-to-cart">Add to cart</button></form></main></body>`);
    const result = resolveAnchor({ ...base, attrs: { id: "add-to-cart" } }, doc);
    expect(result.confidence).toBe("exact");
    expect((result.el as HTMLElement).id).toBe("add-to-cart");
  });

  it("tier 1: finds by data-testid even when the tree moved", () => {
    const doc = load(`<body><div><section><button data-testid="buy">Buy now</button></section></div></body>`);
    const result = resolveAnchor({ ...base, name: "Buy now", text: "Buy now", attrs: { "data-testid": "buy" } }, doc);
    expect(result.confidence).toBe("exact");
  });

  it("tier 2: uses the XPath when role and name still match", () => {
    const doc = load(`<body><main><form><button>Add to cart</button></form></main></body>`);
    expect(resolveAnchor(base, doc).confidence).toBe("exact");
  });

  it("tier 2: REJECTS an XPath that now points at a different element", () => {
    const doc = load(`<body><main><form><button>Subscribe</button></form></main></body>`);
    const result = resolveAnchor(base, doc);
    // Must not pin "Add to cart" onto the Subscribe button.
    expect(result.el).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it("tier 3: falls through to role + name, picking the ordinal-th match", () => {
    const doc = load(`<body><ul>
      <li><button>Add to cart</button></li>
      <li><button>Add to cart</button></li>
      <li><button>Add to cart</button></li>
    </ul></body>`);
    const result = resolveAnchor({ ...base, ordinal: 2 }, doc);
    expect(result.confidence).toBe("likely");
    expect([...doc.querySelectorAll("button")].indexOf(result.el as HTMLButtonElement)).toBe(2);
  });

  it("tier 3: an out-of-range ordinal does not crash or pick the wrong one", () => {
    const doc = load(`<body><main><button>Add to cart</button></main></body>`);
    const result = resolveAnchor({ ...base, ordinal: 7 }, doc);
    // One candidate, ordinal beyond it: take the only match rather than nothing.
    expect(result.el).not.toBeNull();
    expect(result.confidence).toBe("likely");
  });

  it("tier 4: matches on exact visible text when the accessible name changed", () => {
    const doc = load(`<body><main><button aria-label="cart-add-1">Add to cart</button></main></body>`);
    const result = resolveAnchor({ ...base, name: "Add to cart (hat)" }, doc);
    expect(result.confidence).toBe("likely");
  });

  it("tier 5: a unique fuzzy match is a guess", () => {
    const doc = load(`<body><main><button>Add hat to your cart</button></main></body>`);
    const result = resolveAnchor({ ...base, text: "" }, doc);
    expect(result.confidence).toBe("guess");
  });

  it("tier 5: DECLINES a fuzzy match with several candidates", () => {
    const doc = load(`<body><main>
      <button>Add hat to your cart</button>
      <button>Add scarf to your cart</button>
    </main></body>`);
    expect(resolveAnchor({ ...base, text: "" }, doc).el).toBeNull();
  });

  it("returns unlocated when the element is simply gone", () => {
    const doc = load(`<body><main><p>Sold out</p></main></body>`);
    const result = resolveAnchor(base, doc);
    expect(result.el).toBeNull();
    expect(result.confidence).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @friction/overlay test`
Expected: FAIL — `Cannot find module './resolve'`

- [ ] **Step 4: Write the implementation**

Create `packages/overlay/src/resolve.ts`:

```ts
/**
 * Finding a scanned element again, later, on a page that has moved on.
 *
 * A ladder, most trustworthy first. The rule that matters is in tier 2: an
 * XPath hit is VERIFIED against the anchor's role and name before it is
 * accepted. A bare XPath match is not evidence — page structure changes, and
 * pinning "Add to cart" onto a Subscribe button costs the user's trust in
 * every correct marker too.
 */
import type { Anchor } from "@friction/shared";

export type Confidence = "exact" | "likely" | "guess";

export interface Resolution {
  el: Element | null;
  /** Null exactly when el is null. */
  confidence: Confidence | null;
}

const UNLOCATED: Resolution = { el: null, confidence: null };

const IMPLICIT_ROLES: Record<string, string> = {
  a: "link", button: "button", select: "combobox", textarea: "textbox",
  summary: "button", form: "form", nav: "navigation", main: "main",
  h1: "heading", h2: "heading", h3: "heading",
};

/** Mirrors roleOf() in apps/orchestrator/src/pageScripts.ts. The two must agree. */
export function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.trim().split(/\s+/)[0] ?? "generic";
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (type === "checkbox" || type === "radio") return type;
    return type === "button" || type === "submit" || type === "reset" ? "button" : "textbox";
  }
  return IMPLICIT_ROLES[tag] ?? "generic";
}

const clean = (s: string | null | undefined): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

/** Mirrors labelOf() in pageScripts.ts, minus the label[for] lookup that needs CSS.escape. */
export function accessibleName(el: Element): string {
  const aria = clean(el.getAttribute("aria-label"));
  if (aria) return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const text = clean(by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" "));
    if (text) return text;
  }
  const wrap = el.closest("label");
  if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
  return clean(
    el.getAttribute("alt") ?? el.getAttribute("title") ?? el.getAttribute("placeholder") ??
    (el as HTMLElement).innerText ?? el.textContent ?? el.getAttribute("name") ?? el.id ?? el.tagName.toLowerCase(),
  );
}

const STOPWORDS = new Set(["the", "and", "for", "you", "your", "our", "with", "from", "this", "that", "now", "get", "all", "off", "to", "a", "an"]);

/** Crude stems of a label's meaningful words: "Added to cart" -> {add, cart}. Mirrors actor.ts. */
function stems(label: string): Set<string> {
  const out = new Set<string>();
  for (const word of label.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    out.add(word.replace(/(ing|ed|es|s)$/, "") || word);
  }
  return out;
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const stem of b) if (a.has(stem)) return true;
  return false;
}

function byXPath(xpath: string, doc: Document): Element | null {
  try {
    const node = doc.evaluate(xpath, doc, null, 9 /* FIRST_ORDERED_NODE_TYPE */, null).singleNodeValue;
    return node && node.nodeType === 1 ? (node as Element) : null;
  } catch {
    return null;
  }
}

/** Does this element still look like the thing that was scanned? */
function matchesIdentity(el: Element, anchor: Anchor): boolean {
  return roleOf(el) === anchor.role && accessibleName(el) === anchor.name;
}

export function resolveAnchor(anchor: Anchor, doc: Document): Resolution {
  // Tier 1: a unique, stable attribute. Survives almost any restructure.
  for (const key of ["id", "data-testid", "data-test", "data-cy", "data-qa"]) {
    const value = anchor.attrs[key];
    if (!value) continue;
    const selector = key === "id" ? `#${CSS.escape(value)}` : `[${key}="${CSS.escape(value)}"]`;
    let found: NodeListOf<Element>;
    try {
      found = doc.querySelectorAll(selector);
    } catch {
      continue;
    }
    if (found.length === 1 && roleOf(found[0]!) === anchor.role) return { el: found[0]!, confidence: "exact" };
  }

  // Tier 2: the XPath -- but only if the element it lands on is still the same thing.
  const positional = byXPath(anchor.xpath, doc);
  if (positional && matchesIdentity(positional, anchor)) return { el: positional, confidence: "exact" };

  // Tier 3: role + accessible name, disambiguated by capture-time ordinal.
  const named = [...doc.querySelectorAll<Element>("*")].filter((el) => roleOf(el) === anchor.role && accessibleName(el) === anchor.name);
  if (named.length > 0) return { el: named[Math.min(anchor.ordinal, named.length - 1)]!, confidence: "likely" };

  // Tier 4: same tag, same visible text. Catches a renamed aria-label.
  if (anchor.text) {
    const byText = [...doc.querySelectorAll<Element>(anchor.tag)].filter((el) => clean((el as HTMLElement).innerText ?? el.textContent) === anchor.text);
    if (byText.length > 0) return { el: byText[Math.min(anchor.ordinal, byText.length - 1)]!, confidence: "likely" };
  }

  // Tier 5: fuzzy, and ONLY when exactly one candidate survives. A fuzzy match
  // with three candidates is a coin flip wearing a badge.
  const wanted = stems(anchor.name);
  const fuzzy = [...doc.querySelectorAll<Element>("*")].filter((el) => roleOf(el) === anchor.role && overlaps(wanted, stems(accessibleName(el))));
  if (fuzzy.length === 1) return { el: fuzzy[0]!, confidence: "guess" };

  return UNLOCATED;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @friction/overlay test`
Expected: PASS, all eleven cases. The two that matter most are "REJECTS an XPath that now points at a different element" and "DECLINES a fuzzy match with several candidates" — if either is green only because `resolveAnchor` returns `UNLOCATED` too eagerly, the tier 1/2/3 tests would be red, so read the whole run.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no errors

```bash
git add packages/overlay
git commit -m "feat(overlay): anchor resolution ladder with verified XPath matching"
```

---

### Task 9: Render markers, cards and the panel

**Files:**
- Create: `packages/overlay/src/styles.ts`
- Create: `packages/overlay/src/render.ts`

**Interfaces:**
- Consumes: `Resolution`, `Confidence` from Task 8; `AnnotationFinding`, `AnnotationsResponse` from Task 5.
- Produces: `mountOverlay(response: AnnotationsResponse, doc: Document): OverlayHandle`, `OverlayHandle { destroy(): void; focusFinding(findingId: string): void }`, `OVERLAY_ROOT_ID = "__friction-root"`.

Rendering is verified by eye against the demo shop, not by unit test — asserting on markup would pin down styling decisions the next person should be free to change. The logic worth testing lives in Task 8.

- [ ] **Step 1: Write the styles**

Create `packages/overlay/src/styles.ts` exporting one `CSS` string constant. It is injected into the shadow root, so no selector needs a prefix. Requirements:

- `:host { all: initial; }` — the shadow root must not inherit the host page's typography.
- A `.marker` class: `position: absolute`, a 22px circular badge, `z-index: 2147483000`, `pointer-events: auto`.
- Confidence variants: `.marker--exact` solid 2px ring, `.marker--likely` dashed 2px ring, `.marker--guess` dotted 2px ring at 70% opacity.
- Severity colors 1–5 as `.sev-1` … `.sev-5`, cool to hot.
- `.panel` fixed bottom-right, `max-height: 60vh`, scrollable, collapsible.
- `.card` absolutely positioned, `max-width: 340px`, with a `<details>` block for the patch.
- Every rule must be inside the shadow root's stylesheet. **Do not write to `document.head`.**

- [ ] **Step 2: Write the renderer**

Create `packages/overlay/src/render.ts`. It must:

1. Create `<div id="__friction-root">`, attach `{ mode: "open" }` shadow, inject `CSS` via a `<style>` element, append the div to `doc.body`.
2. Call `resolveAnchor` for every finding. Partition into located and unlocated.
3. For each located finding, create a numbered `.marker` positioned from `el.getBoundingClientRect()` plus `scrollX`/`scrollY`, with the `.marker--<confidence>` and `.sev-<severity>` classes.
4. Reposition all markers on `scroll` and `resize`, throttled with `requestAnimationFrame`. Also observe `doc.body` with a `ResizeObserver` for late-loading layout shifts.
5. Clicking a marker opens its `.card` with: the category label, severity, `summary`, `whyItMatters`, `recommendation`, an `<img loading="lazy">` of `evidenceUrl` when non-null, and `patchJs` inside `<details><summary>Suggested fix</summary>`. The patch must be labelled **"Suggested — not executed and not tested"**; it is advisory text, and the card must not imply otherwise.
6. For `confidence === "guess"`, the card header reads "We think this is the element" rather than stating it.
7. Render the `.panel` listing every finding grouped by `url`. Located rows on the current page scroll their marker into view. Rows for other pages are `<a href>` links. Unlocated rows are listed under a heading that says they could not be found on this page.
8. Return an `OverlayHandle` whose `destroy()` removes the root element and **every listener and observer it added**. Leaking a scroll listener onto the user's own site is not acceptable.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 4: Check the bundle budget early**

Run: `pnpm --filter @friction/overlay build` (the build script lands in Task 10; if it does not exist yet, run `npx esbuild src/render.ts --bundle --minify --format=iife | wc -c` from `packages/overlay`)
Expected: under 25 KB. If it is over, the styles are too elaborate — cut them, not the resolution ladder.

- [ ] **Step 5: Commit**

```bash
git add packages/overlay/src/styles.ts packages/overlay/src/render.ts
git commit -m "feat(overlay): shadow-root renderer for markers, cards and the panel"
```

---

### Task 10: The entry point and the bookmarklet build

**Files:**
- Create: `packages/overlay/src/main.ts`
- Create: `packages/overlay/build.mjs`

**Interfaces:**
- Consumes: `mountOverlay`, `OVERLAY_ROOT_ID` from Task 9; `AnnotationsResponse`, `OVERLAY_VERSION` from Task 5.
- Produces: `packages/overlay/dist/overlay.iife.js` (minified IIFE) and `packages/overlay/dist/bookmarklet.txt` (the URL-encoded `javascript:` string).

- [ ] **Step 1: Write the entry point**

Create `packages/overlay/src/main.ts`. It must, in this order:

1. **Toggle off if already mounted.** If `window.__frictionOverlay` exists, call its `destroy()`, delete the global, and return. Same versioned-sentinel trick as `window.__fr` in `pageScripts.ts` — store `{ version: OVERLAY_VERSION, destroy }` so a newer bundle replaces a stale one rather than stacking a second overlay.
2. Read `sessionStorage` key `__friction_annotations`. If it holds a payload for this hostname, use it and skip the fetch. This is what makes the second click after navigating instant.
3. Otherwise `fetch(\`${WORKER_ORIGIN}/api/annotations?host=${encodeURIComponent(location.hostname)}\`)`, where `WORKER_ORIGIN` is injected at build time by esbuild's `define` (Step 2).
4. Handle each failure explicitly:
   - The fetch rejecting with a `TypeError` means the site's CSP `connect-src` blocked it. Mount the panel in an error state saying the site's security policy blocked the request, and link the offline bookmarklet (Task 12). **Do not** report this as "no scan found" — it is the opposite problem and the user needs to know which one they have.
   - `404` → panel reading "No Friction scan for `<hostname>` yet", with a link to the control room.
   - Any other non-OK status → the status and the response body's `error` field.
5. On success, write the payload to `sessionStorage` and call `mountOverlay`.
6. If `response.overlayVersion > OVERLAY_VERSION`, show a line in the panel telling the user to re-drag the bookmarklet.
7. If every finding resolves as unlocated, still open the panel with all of them listed. **Never render an empty overlay** — an empty overlay reads as "no problems here", which is a lie.
8. If a `__friction_focus` key is in `sessionStorage`, call `handle.focusFinding()` with it and clear the key.

- [ ] **Step 2: Write the build script**

Create `packages/overlay/build.mjs`:

```js
/**
 * Builds the overlay twice: a minified IIFE, and that IIFE wrapped as a
 * javascript: URL for the bookmarks bar.
 *
 * keepNames is off on purpose. tsx's esbuild turns it ON, which wraps every
 * function in a __name() helper that does not exist in a remote page -- the
 * reason apps/orchestrator/src/pageScripts.ts is written as strings. This
 * package has its own build, so it can be real TypeScript.
 */
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? "http://localhost:8787";
const LIMIT = 25 * 1024;

await mkdir("dist", { recursive: true });

const result = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  keepNames: false,
  format: "iife",
  target: "es2020",
  define: { WORKER_ORIGIN: JSON.stringify(WORKER_ORIGIN) },
  write: false,
});

const code = result.outputFiles[0].text;
await writeFile("dist/overlay.iife.js", code);

const bookmarklet = `javascript:${encodeURIComponent(code)}`;
await writeFile("dist/bookmarklet.txt", bookmarklet);

console.log(`overlay ${(code.length / 1024).toFixed(1)} KB, bookmarklet ${(bookmarklet.length / 1024).toFixed(1)} KB`);
if (bookmarklet.length > LIMIT) {
  console.error(`bookmarklet is ${bookmarklet.length} bytes; the cap is ${LIMIT}`);
  process.exit(1);
}
```

Declare `WORKER_ORIGIN` for TypeScript by adding to `packages/overlay/src/main.ts`:

```ts
declare const WORKER_ORIGIN: string;
```

- [ ] **Step 3: Build and check the budget**

Run: `pnpm --filter @friction/overlay build`
Expected: prints both sizes and exits 0. A non-zero exit means the bundle blew the 25 KB cap — cut styles, not the ladder.

- [ ] **Step 4: Test it by hand against the demo shop**

With the Worker and control room running, run a scan against the bundled demo shop and wait for `completed`. Then open the demo shop in a browser, open devtools, paste the contents of `dist/overlay.iife.js` into the console, and press enter.

Expected: markers appear on the findings' elements and the panel lists the rest. Paste it a second time — the overlay should **disappear**, not double.

- [ ] **Step 5: Test the failure paths by hand**

- Visit a site you have not scanned, paste the bundle → "No Friction scan for … yet".
- Visit a site with a strict CSP (github.com works) and paste the bundle → the CSP message, not the 404 message.

- [ ] **Step 6: Commit**

```bash
git add packages/overlay/src/main.ts packages/overlay/build.mjs
git commit -m "feat(overlay): entry point, failure states and the bookmarklet build"
```

---

### Task 11: Hand the bookmarklet to the user

**Files:**
- Create: `apps/control-room/src/components/BookmarkletCard.tsx`
- Modify: `apps/control-room/src/components/scan/TaskPanel.tsx` (or the scan root node's panel, wherever a completed scan's summary is rendered)
- Modify: `apps/control-room/vite.config.ts`

**Interfaces:**
- Consumes: `dist/bookmarklet.txt` from Task 10.
- Produces: `<BookmarkletCard scanUrl={string} />`.

- [ ] **Step 1: Make the bookmarklet importable**

The bookmarklet is a build artifact, so import it as a raw string rather than copying it into source. In `apps/control-room/vite.config.ts`, confirm `assetsInclude` covers `.txt`, or add:

```ts
  assetsInclude: ["**/*.txt"],
```

Add `@friction/overlay: workspace:*` to `apps/control-room/package.json` dependencies and run `pnpm install`.

- [ ] **Step 2: Write the card**

Create `apps/control-room/src/components/BookmarkletCard.tsx`:

```tsx
import bookmarklet from "@friction/overlay/dist/bookmarklet.txt?raw";

/**
 * A bookmarklet cannot be installed by script -- it has to be dragged. So this
 * is a real anchor whose href IS the bookmarklet, with drag instructions, and
 * a copy button for browsers where dragging is awkward.
 */
export function BookmarkletCard({ scanUrl }: { scanUrl: string }): React.ReactElement {
  const host = (() => {
    try {
      return new URL(scanUrl).hostname;
    } catch {
      return scanUrl;
    }
  })();

  return (
    <section className="rounded-lg border border-neutral-700 p-4">
      <h3 className="font-medium">See these findings on your own site</h3>
      <p className="mt-1 text-sm text-neutral-400">
        Drag this to your bookmarks bar, then open {host} and click it. Findings appear on the real elements.
      </p>
      <a
        href={bookmarklet}
        draggable
        onClick={(e) => e.preventDefault()}
        className="mt-3 inline-block rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        Annotate my site
      </a>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(bookmarklet)}
        className="ml-2 text-sm text-neutral-400 underline"
      >
        Copy instead
      </button>
    </section>
  );
}
```

`onClick={(e) => e.preventDefault()}` matters: clicking the link inside the control room would run the overlay against the control room itself, which has no scan and would show a confusing 404.

- [ ] **Step 3: Render it on a completed scan**

In the component that renders a completed scan's summary, render `<BookmarkletCard scanUrl={scan.url} />` when `scan.status === "completed"`. Do not render it while the scan is still running — there is nothing to annotate yet.

- [ ] **Step 4: Verify in the browser**

Run: `pnpm dev`
Expected: on a completed scan, the card appears. Drag the link to the bookmarks bar, open the demo shop, click the bookmark — the overlay mounts. This is the first end-to-end test of the real user flow; if it works here it works.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no errors

```bash
git add apps/control-room packages/overlay
git commit -m "feat(control-room): hand the annotation bookmarklet to the user"
```

---

### Task 12: The offline bookmarklet escape hatch

**Files:**
- Modify: `packages/overlay/build.mjs`
- Modify: `apps/control-room/src/components/BookmarkletCard.tsx`

**Interfaces:**
- Consumes: everything from Tasks 9–11.
- Produces: `dist/overlay-offline.iife.js`, and a second link in `BookmarkletCard` that inlines a specific scan's payload.

This exists **only** for the CSP failure path from Task 10, step 4. It is not a second product and gets no UI beyond a secondary link.

- [ ] **Step 1: Build an offline variant**

In `build.mjs`, add a second `build()` call over a new entry `src/offline.ts`, which imports `mountOverlay` and mounts a payload read from a global `__FRICTION_DATA__` instead of fetching. Write it to `dist/overlay-offline.iife.js`. Do not URL-encode this one — the control room assembles the final URL per scan, because the payload differs every time.

- [ ] **Step 2: Assemble it per scan in the card**

In `BookmarkletCard.tsx`, add a secondary "Site blocking it? Offline version" link whose `href` is built at render time:

```tsx
const offlineHref = `javascript:${encodeURIComponent(`window.__FRICTION_DATA__=${JSON.stringify(annotations)};${offlineBundle}`)}`;
```

where `annotations` is the `AnnotationsResponse` the control room already fetched for this scan. Fetch it from `/api/annotations?token=${scan.id}` — this is what the `token` parameter exists for.

- [ ] **Step 3: Guard the size**

A large scan makes a large URL. If `offlineHref.length > 60000`, render a disabled link with a note that the scan is too large for the offline bookmarklet. Firefox handles roughly 64 KB; do not silently produce a bookmarklet that will not save.

- [ ] **Step 4: Verify on a CSP-strict site**

Run a scan, then open a site with a strict `connect-src` and click the offline bookmarklet. Expected: the overlay mounts with no network call.

- [ ] **Step 5: Commit**

```bash
git add packages/overlay/build.mjs packages/overlay/src/offline.ts apps/control-room/src/components/BookmarkletCard.tsx
git commit -m "feat(overlay): offline bookmarklet for CSP-restricted sites"
```

---

## Self-Review

**Spec coverage.** Walked each spec section against the tasks:

| Spec section | Task |
| --- | --- |
| Anchor type, excluded `class`, href pathname | 1, 3 |
| Anchor capture at scan time | 3, 4 |
| Resolution ladder, tiers 1–6 | 8 |
| Tier 2 verification | 8, step 2 test "REJECTS an XPath…" |
| Confidence rendering | 9, step 1 |
| Shadow root isolation | 9, steps 1–2 |
| Markers, cards, panel | 9 |
| Navigation via sessionStorage | 10, step 1 |
| Idempotence / versioned sentinel | 10, step 1 |
| `GET /api/annotations`, host + token | 5, 6, 7 |
| Scoped CORS, negative assertion | 7, step 3 |
| `overlayVersion` staleness notice | 10, step 1 |
| Error handling table (4 rows) | 10, steps 1, 4, 5 |
| Bookmarklet size constraint | 10, step 3 (enforced by build exit code) |
| Offline escape hatch | 12 |
| Backward compatibility (anchor-less scans) | 2, 5 |

**Gap found and closed:** the spec's testing table names a worker route test, but the Worker has no test harness and adding one is out of proportion. Task 5 moves every decidable rule into `packages/shared/src/annotations.ts` under vitest, and Task 7 step 3 covers the CORS scoping with an explicit negative `curl` check. The spec's requirement that the negative case be asserted is met, by a different mechanism than it assumed.

**Placeholder scan:** Tasks 9, 10 and 12 specify behaviour as numbered requirements rather than full source. That is deliberate for rendering and bundling — pinning exact markup would freeze styling decisions the implementer should own — but each requirement is concrete and checkable, and every function signature they must produce is named in the task's Interfaces block. No "TBD", no "handle edge cases", no "similar to Task N".

**Type consistency:** `resolveAnchor`, `roleOf`, `accessibleName`, `mountOverlay`, `OverlayHandle`, `destroy()`, `focusFinding()`, `parseAnnotationsQuery`, `toAnnotationFinding`, `getLatestScanByHost`, `normalizeHost`, `OVERLAY_VERSION`, `ANCHOR_ATTRS` are spelled identically everywhere they appear. `roleOf` is implemented twice on purpose — once as a string in `pageScripts.ts` (Task 3) and once as TypeScript in `resolve.ts` (Task 8) — and both carry a comment saying the two must agree.
