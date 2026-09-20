# Annotation overlay: design

Date: 2026-09-19
Status: approved in brainstorming, awaiting spec review

## Goal

Replace the fix-verification cycle with an annotation overlay. Today, proving a finding is real costs a full second agent run per finding (`verify.ts`): a fresh browser, the patch injected with `addInitScript`, the whole task replayed, then `judgeVerification` rules on the comparison. The output is a verdict in the control room.

This document specifies **phase 1: building the overlay**, which is additive and ships on its own. Retiring the verify lane is phase 2 and gets its own spec; see Sequencing.

Instead: the user drags a bookmarklet to their bookmarks bar, visits their own site, clicks it, and sees Friction's findings drawn **on the real page, pinned to the real elements**. The scan gets faster and cheaper (one agent run per task, not one per task plus one per finding), and the result lands where the problem actually lives rather than in a dashboard.

The fix proposer (`fixer.ts`) stays. Its patch becomes advisory text inside an annotation card instead of something that gets executed.

## User flow

1. A scan finishes in the control room. The scan page shows a **Annotate my site** affordance with a draggable bookmarklet link.
2. The user drags it to their bookmarks bar. Once, ever — it is not per-scan.
3. They visit any page of their own site and click the bookmark.
4. The overlay reads `location.hostname`, asks the Worker for the latest completed scan for that host, and draws:
   - numbered markers on every finding whose element resolves on this page
   - a collapsible panel, bottom-right, listing every finding in the scan grouped by URL
5. Clicking a marker opens a card: what went wrong, why it matters, the recommendation, the evidence screenshot, and the suggested fix in a collapsed `<details>`.
6. Clicking the bookmark again removes the overlay.

## Scope

In scope:

- a richer `Anchor` captured at scan time, and a resolution ladder that finds the element again later
- `packages/overlay`: a new dependency-free workspace package, built to one self-contained IIFE
- `GET /api/annotations` on the Worker, CORS-open on that route alone
- the bookmarklet handoff UI in the control room
- an offline bookmarklet with findings baked in, as the CSP escape hatch

Out of scope (deliberately):

- **Removing the `verify` lane.** That is a separate, sequenced piece of work; see Sequencing below.
- A browser extension. Rejected during brainstorming: better UX, but a separate shipping artifact with store review.
- Injecting a `<script>` tag. Rejected: `script-src` CSP blocks it on exactly the sites most worth scanning.
- Annotating a site the user has not scanned. The endpoint answers for known hosts only.
- Auto-re-arming the overlay after navigation. A bookmarklet cannot re-run itself; see Navigation below.
- Editing or dismissing findings from the overlay. It is a read-only view of a completed scan.
- Authentication on the annotations endpoint beyond an optional token. The Worker's current posture is demo-grade (`GET /api/scans` is already unauthenticated); this design does not fix that, but it does not widen it either.

## Sequencing

Two phases, in order. They are independent and phase 1 ships alone.

**Phase 1 — build annotation.** Purely additive. Nothing existing breaks. `verify.ts` keeps running exactly as it does now.

**Phase 2 — remove the verify lane.** Only after phase 1 is carrying its weight.

The reason for the split: `verify` is not a file, it is a **lane**, threaded through 36 files — the event schema (`events.ts`), the D1 tables, the SSE stream (`stream.ts`, `hub.ts`), `LaneEmitter`, `FixReport`'s stage machine, and five control-room components (`LanePane`, `FixComparison`, `RoomComparison`, `runState`, `scan/nodes`). Removing it is a refactor of the event model. Doing it in the same pass as a new feature means that if the overlay disappoints, the thing it replaced is already gone.

## Architecture

```
SCAN TIME (orchestrator)                        ANNOTATE TIME (user's browser)
------------------------                        ------------------------------
actor.ts locates an element                     user clicks the bookmarklet
  -> pageScripts.locateScript()                   -> reads location.hostname
     now also returns an Anchor                   -> fetch worker /api/annotations?host=
  -> StepPayload carries it                       -> resolve each Anchor vs the live DOM
  -> FrictionPayload carries it                   -> markers for hits
  -> Worker (D1)                                  -> panel rows for misses
```

Nothing about the agent loop, the detectors (`friction.ts`), or the fix proposer changes. The anchor rides along on payloads that already exist.

### What the bookmarklet is

One `javascript:` URL containing the **entire** overlay — resolver, renderer and styles — as a minified IIFE, plus the fetch call. Nothing external loads at click time except the evidence images.

This is approach A from brainstorming, chosen over injecting a `<script src=…>` because script-tag injection is blocked by `script-src` CSP on exactly the sites most worth scanning, whereas a bookmarklet's own code is not. Expected size is 15–25 KB URL-encoded, which Chrome, Firefox and Safari all accept as a bookmark. Keeping it under that is a design constraint on the overlay: **no runtime dependencies, no framework.**

### New and changed files

| File | Change |
| --- | --- |
| `packages/shared/src/anchor.ts` | **new** — the `Anchor` type, its zod schema, host normalization, pure helpers |
| `packages/shared/src/events.ts` | add optional `anchor` to `StepPayload` and `FrictionPayload` |
| `packages/shared/src/api.ts` | the `AnnotationsResponse` contract |
| `apps/orchestrator/src/pageScripts.ts` | `locateScript` returns the full anchor |
| `apps/orchestrator/src/actor.ts` | thread the anchor into `StepPayload` |
| `apps/orchestrator/src/emitter.ts` | carry the anchor onto the deduplicated finding |
| `packages/overlay/` | **new package** — resolver, renderer, styles, esbuild config |
| `apps/worker/src/index.ts` | `GET /api/annotations`, with its own scoped CORS |
| `apps/worker/src/scanDb.ts` | look up the latest completed scan by host |
| `apps/control-room/src/components/` | the bookmarklet handoff |

`anchor` is **optional** on the payload schemas. Scans recorded before this change still parse; their findings simply resolve as `unlocated` and appear in the panel.

## The Anchor

The existing `selector` is an absolute XPath, e.g. `xpath=/html/body/main/div/div[2]/form/button`. That is sufficient to click something mid-run and insufficient to find it again on a fresh page load days later. It encodes structure, and structure is the least stable thing about a page.

```ts
export interface Anchor {
  /** Absolute XPath, as today. Used, but never trusted on its own. */
  xpath: string;
  /** "button" */
  tag: string;
  /** Explicit role attribute, or the implicit role for the tag. */
  role: string;
  /** Accessible name. pageScripts' labelOf() already computes exactly this. */
  name: string;
  /** Cleaned innerText, <= 90 chars. */
  text: string;
  /** Whitelisted stable attributes: id, data-*, name, type, aria-label, href pathname. */
  attrs: Record<string, string>;
  /** Index among elements matching role + name on the page at capture time. */
  ordinal: number;
  /** location.pathname when captured. */
  path: string;
}
```

`class` is deliberately excluded. Utility CSS (Tailwind) makes class names non-distinctive, and CSS-module hashing makes them change on every build — they would be worse than useless as an identity signal.

`href` is stored as pathname only, so a query string or tracking parameter does not break the match.

### Capture

`locateScript` in `pageScripts.ts` already runs against the element and returns its label and bounding box. It gains the anchor fields. Same constraint as the rest of that file: it stays a **string**, because tsx's esbuild `keepNames` wraps functions in a `__name()` helper that does not exist in the page.

### Resolution

Runs in the overlay, in the user's browser. First hit wins.

| # | Strategy | Confidence |
| --- | --- | --- |
| 1 | Unique `#id` or `[data-testid]` from `attrs`; role must still match | `exact` |
| 2 | XPath, **then verify** the found element's role and name still match the anchor | `exact` |
| 3 | All elements matching role + accessible name, take the `ordinal`-th | `likely` |
| 4 | Matching tag + exact `text` | `likely` |
| 5 | Role + fuzzy name by word stems (the `stems()` / `labelsRelated()` approach in `actor.ts`), **only** if exactly one candidate survives | `guess` |
| 6 | nothing | `unlocated` |

**Tier 2's verification step is the load-bearing decision in this design.** A bare XPath hit is not trusted. If `/html/body/main/div[2]/button` now resolves to a "Subscribe" button where the scan found "Add to cart", the match is rejected and resolution falls through to tier 3. Without that check, the overlay eventually pins a finding to a confidently wrong element, and a single bad pin costs the user's trust in every good one.

Tier 5 is capped at a unique candidate for the same reason: a fuzzy match with three candidates is a coin flip wearing a badge.

Markers render their confidence honestly — solid ring for `exact`, dashed for `likely`, dotted with hedged wording ("we think this is the element") for `guess`.

### Why this is testable

Resolution is a pure function of `(Anchor, Document)`. `packages/overlay` gets its own esbuild config, so unlike `pageScripts.ts` it can set `keepNames: false` and be written as **real TypeScript modules rather than strings**. With happy-dom over fixture HTML, the cases that matter get real tests:

- clean hit on a stable id
- XPath drifted to a different element — must reject and fall through, not pin
- twelve identical "Add to cart" buttons — `ordinal` picks the right one
- element genuinely absent — `unlocated`, not a wrong guess
- fuzzy match with multiple candidates — must decline

## The overlay

### Isolation

Everything renders inside a single `<div id="__friction-root">` hosting a **shadow root**. Non-negotiable in both directions: the host site's reset CSS would otherwise mangle the overlay, and the overlay's styles would otherwise leak onto the site the user is trying to evaluate.

### Markers

Absolutely positioned numbered badges, colored by severity, placed from `getBoundingClientRect()` plus scroll offset. Repositioned on `ResizeObserver` and a throttled scroll listener. Elements that resolve but are off-screen still get a marker; the panel row scrolls to it.

### Cards

Clicking a marker opens a card containing, from the existing `FrictionPayload`:

- category label and severity (`FRICTION_LABELS`)
- `summary` — what went wrong
- `whyItMatters`
- `recommendation`
- the evidence screenshot, by absolute R2 URL, loaded lazily
- the proposed `patchJs` in a collapsed `<details>`, clearly labelled as a suggestion that was not executed

### Panel

Collapsible, bottom-right, listing every finding in the scan grouped by URL. Rows for the current page scroll to their marker. Rows for other pages are ordinary links.

### Navigation

A bookmarklet cannot re-run itself after a page load. This is a real constraint, not a detail to paper over.

Clicking an other-page panel row navigates normally, and the user clicks the bookmark again on the new page. `sessionStorage` holds the scan payload and the finding they clicked, so the second click needs no fetch and lands already scrolled to the right marker. The panel says so plainly rather than implying the overlay follows them.

### Idempotence

Clicking the bookmark while the overlay is mounted removes it. Same versioned-global trick as `window.__fr` in `pageScripts.ts`: a `window.__frictionOverlay` sentinel carrying a version, so a stale overlay from an older bookmarklet is replaced rather than stacked.

## The endpoint

```
GET /api/annotations?host=example.com
GET /api/annotations?token=<scan token>
```

- `Access-Control-Allow-Origin: *`, `GET` only, **registered with its own `cors()` config on this route alone**. The global middleware in `index.ts` stays restricted to localhost and `*.pages.dev` (`isAllowedOrigin` in `shared/src/util.ts`). Widening the global policy is not acceptable — it would open every mutating route.
- Host normalization: lowercase, strip a leading `www.`, ignore port. Returns the most recent scan with status `completed` for that host.
- `?token=` is the **scan id**, and returns that specific scan regardless of host. Exactly one of `host` or `token` must be given; both or neither is a 400.
- Both parameters are supported from day one. The control room emits `?host=` links; `?token=` exists so access can be tightened later — by narrowing or removing the host lookup — without redesigning the endpoint or reissuing bookmarklets.

Response:

```ts
interface AnnotationsResponse {
  scanId: string;
  scannedAt: number;
  url: string;
  /** Lets the panel tell the user their bookmarklet is out of date. */
  overlayVersion: number;
  findings: AnnotationFinding[];
}

/** A deduplicated finding, flattened for the overlay. Derived from FrictionPayload. */
interface AnnotationFinding {
  findingId: string;
  category: FrictionCategory;
  severity: Severity;
  summary: string;
  whyItMatters: string;
  recommendation: string;
  /** The page the finding happened on, normalized. Groups the panel. */
  url: string;
  /** Absent for scans recorded before this change: resolves as `unlocated`. */
  anchor: Anchor | null;
  /** Absolute R2 URL, or null when no screenshot was captured. */
  evidenceUrl: string | null;
  /** The proposed fix, advisory only. Null when no acceptable patch was produced. */
  patchJs: string | null;
  hitCount: number;
}
```

The endpoint flattens what the control room already assembles for `GET /api/scans/:id/report`; it does not introduce a second source of truth for findings.

`overlayVersion` is the cost of baking the overlay into the bookmarklet: shipping an overlay fix requires the user to re-drag. The panel surfaces that rather than silently running an old renderer.

## Error handling

| Condition | Behaviour |
| --- | --- |
| CSP `connect-src` blocks the fetch | The `fetch` rejects with a `TypeError`. Catch it specifically, render a panel explaining that the site's security policy blocked the request, and link the offline bookmarklet. |
| No completed scan for this host | "No Friction scan for example.com yet", with a link to the control room. |
| Scan exists, zero anchors resolve | Open the panel with every finding listed as unlocated. Never render an empty overlay — an empty overlay reads as "no problems here", which is a lie. |
| Malformed or absent anchor (pre-change scan) | That finding is `unlocated`. Not an error. |

The offline bookmarklet — the same overlay with findings baked into the `javascript:` URL as a JSON literal, no network call — exists **only** as the escape hatch for row one. It is not a second product and does not get its own UI surface beyond that error state.

## Testing

| Suite | Tool | Covers |
| --- | --- | --- |
| `packages/shared/src/anchor.test.ts` | vitest | host normalization, attribute whitelisting, schema round-trip, backward compatibility with anchor-less payloads |
| `packages/overlay/src/resolve.test.ts` | vitest + happy-dom | the full resolution ladder against fixture HTML. **The test that matters.** |
| `apps/worker` route test | vitest | host normalization, 404 body, CORS header present on `/api/annotations` and absent from other routes |
| `apps/orchestrator/scripts/smoke-local.ts` | existing smoke | a real browser produces a well-formed anchor |

The worker test must assert the negative case — that the open CORS header does **not** appear on `/api/runs` — or the scoped-CORS decision is unenforced.

## What gets worse

Stated plainly, because the design trades something real away.

1. **Findings stop being proven.** `judgeVerification` is the thing that currently refuses to call a finding real until it has been re-tested. Phase 2 removes it. Findings become "the detectors fired and the model described it", not "we reproduced it with the fix and watched it stop". That is the trade being made for speed and cost.
2. **`validatePatch` stops being a sandbox guarantee.** Its rules (no `fetch`, no cookies, no navigation) currently protect a patch that will actually execute. Once nothing executes patches, the rules are a quality filter on advisory text. Keep them — they still stop the model writing nonsense — but do not describe them as a security boundary afterwards.
3. **`pr.ts` will claim verification it no longer has.** `buildPullRequest` builds a before/after table from `LaneResult`s that phase 2 deletes. Phase 2 must either rewrite that body or remove the PR path. It cannot be left as-is; shipping a PR that says "Verified:" when nothing was verified is the one outcome this project cannot afford.
