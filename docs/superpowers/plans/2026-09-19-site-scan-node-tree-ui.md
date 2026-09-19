# Site Scan + Node Tree: Control Room UI Implementation Plan (revised for the dusk redesign)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the redesigned control room the scan flow: a one-field **Scan & test** home page, a scan page with a React Flow node tree (site → tasks → persona runs) beside a side panel, and the merged site report. Then update the docs.

**Architecture:** The backend is finished (Tasks 1–5). The UI polls `GET /api/scans/:id` for a compact tree and lays it out as fixed columns, with no layout library. It fetches `GET /api/scans/:id/report` when the tree changes. It streams only the selected persona node, reusing `useRunStream` and `PersonaColumn`. The URL holds all the state: `?scan=<id>&node=<nodeId>`, and `?run=<id>` still opens the single-run control room. Every new surface uses the dusk design system from the redesign: `DESIGN.md`, the `index.css` tokens, `Nav`, `badges.tsx` and `icons.tsx`.

**Tech Stack:**
- React 19, Vite 8, Tailwind 4, with its palette reset to the dusk tokens
- TypeScript 7 (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`)
- `@xyflow/react` 12.11.6, the only new dependency
- pnpm 11 workspaces
- Fonts bundled through `@fontsource-variable`

**Spec:** `docs/superpowers/specs/2026-09-19-site-scan-node-tree-design.md`. This plan continues `docs/superpowers/plans/2026-09-19-site-scan-node-tree.md` (Tasks 1–5 done).

## Global Constraints

- **Workspace.** Work only in `C:\Users\ryany\OneDrive\Desktop\friction\.claude\worktrees\site-scan` (branch `feat/site-scan`). Never read from or write to the parent checkout `C:\Users\ryany\OneDrive\Desktop\friction`.
- **Spec authority.** The spec is binding. Where the redesign forced a choice, the choice is recorded under "Design decisions" below. Do not re-decide it.
- **Backend is done.** Do not edit `packages/shared`, `apps/worker` or `apps/orchestrator`. The orchestrator's `POST /runs` and `POST /suggest-tasks` stay: they are API surface, not UI.
- **Dependencies.** The only new dependency is `@xyflow/react` `^12.11.6`, in `apps/control-room`.
- **Offline.** The control room must render with the wifi off: no CDN, web-font or remote image fetches. React Flow's CSS is imported from the package, and the fonts stay on `@fontsource-variable`.
- **URL state.**
  - `?scan=<id>&node=<nodeId>`
  - Node ids are `root`, `t<index>` and `t<index>.<personaId>`. Build them with `scanNodeId` and read them with `parseScanNode` (both from `@friction/shared`).
  - A missing or unknown node means `root`.
  - `?run=<id>[&replay=1][&tab=report]` keeps opening the single-run control room.
- **Layout (spec).**
  - Columns: root (x = 0), tasks (x = 320), personas (x = 660), fixed left to right.
  - The canvas fits the view on load and again when the task nodes first appear.
  - Pan and zoom are on. React Flow's dragging, connecting and selection are off.
  - Every node is a `<button>`: Tab reaches it and Enter selects it.
  - Edges into a running persona node are animated.
  - The side panel is about 460px (`w-115`). Below `lg` it stacks under a fixed-height canvas (`h-105`, 420px).
- **Data (spec).**
  - `useScan` polls every 2000 ms and stops at `completed` or `failed`.
  - A failed poll keeps the last tree and shows a "reconnecting" banner.
  - A 404 means "not found".
  - `useScanReport` refetches when the refresh key changes.
- **Design system (from `apps/control-room/DESIGN.md` and `src/index.css`).**
  - **Palette.** Tailwind's palette is reset (`--color-*: initial`). Only these colour utilities exist: `void graphite frost white black bone ash smoke slate hairline violet sev-1…sev-5`. Classes like `bg-slate-50` or `text-indigo-600` produce **no CSS** and fail silently. Never use them.
  - **Surfaces.** Void canvas. Cards are `rounded-card border border-hairline/10 bg-white/4`. Rows and alerts are `rounded-ui … bg-white/3`. Glass is the `glass` class.
  - **No shadows.** No drop shadows; the nav's is the only one.
  - **Controls** are pills:
    - `pill-cta` is the one white filled button.
    - `pill-ghost` is a hairline pill.
    - Labels are `tag` / `Chip` (10px corners, never pressable).
  - **Violet** is only a wash or glow (`wash`, `wash-sweep`, `glow-dot`). Never violet text, fill, border or a solid dot.
  - **Slate** is for dots and rules only, never text. The quietest text is `text-smoke`.
  - **Type.** DM Sans at weight 500 everywhere: no `font-bold` or `font-semibold` on body text. `font-heading` (Geist) names things. `font-mono` (Geist Mono, with `tracking-normal`) measures: URLs, ids, clocks. Every number gets `tabular-nums`.
  - **Focus.** Keep the global 2px white `:focus-visible` outline. Never add `outline-none` to an interactive element.
  - **Motion.** Every animation stops under `prefers-reduced-motion`.
  - **Copy.** Sentence case everywhere.
- **Tailwind v4 canonical classes.** Where a spacing-scale or theme class exists, use it instead of an arbitrary value:
  - `h-105` (420px), `w-115` (460px), `h-160` (640px), `basis-85` (340px)
  - `w-65` / `w-70` / `w-84`, `rounded-xl` / `rounded-2xl`, `backdrop-blur-xs` (4px)
  - Arbitrary values are allowed only where no token exists and the redesign already uses them: `text-[32px]`, `tracking-[-0.02em]`, `text-[clamp(...)]`, `max-w-[21ch]`.
- **React Flow CSS is unlayered.** An unlayered rule beats any rule in a cascade layer, and all Tailwind utilities live in `@layer utilities`. So overrides of `.react-flow__*` go **unlayered** in `index.css`, scoped under `.scan-flow`.
- **HTML.** A `<button>` holds phrasing content only: `span` and `svg`, never `div`, `p` or `h*`.
- **TypeScript.**
  - Type-only imports use `import type` or inline `type`.
  - React Flow node data must be a `type` alias, not an `interface` (it has to satisfy `Record<string, unknown>`).
- **Persona order** is always `PERSONAS` / `PERSONA_IDS`: impatient, cautious, keyboard.
- **Verification ports.** Another session's dev servers hold 8787, 8788 and 5173. **Never stop anything on 8787, 8788 or 5173.** Verification uses only:
  - Worker on 8797, with its inspector on 9239
  - Orchestrator on 8798
  - Control room on 5183

  Every task that starts servers stops exactly the processes it started.
- **Commits.** Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

## Task structure

This plan keeps the numbering 6, 7, 8 and 9 and the original split, which still holds up:

- **Task 6:** data layer and side panels, verified by typecheck
- **Task 7:** canvas, scan page and routing, verified in a browser
- **Task 8:** home page, verified in a browser
- **Task 9:** docs and full verification

The contents changed with the redesign:

- **Task 6** also gives `PersonaColumn` an optional `idleLabel` and adds two icons to `icons.tsx`.
- **Task 7** puts the scan page under the redesign's floating `Nav`. `Header.tsx` no longer exists.
- **Task 8** replaces `RunForm.tsx` with a new `ScanForm.tsx` inside the existing horizon hero. It does not rewrite a header.
- **Task 9** also updates `apps/control-room/PRODUCT.md` and `DESIGN.md`, so the design system describes what ships.

## Design decisions (forced by the redesign; do not re-decide)

1. **HeroPreview stays, unchanged.** It is a DESIGN.md signature. It is bundled and offline, and it is honestly labelled "Golden run · replay". Each of a scan's 30 runs looks exactly like it, so it remains truthful. A scan-tree preview would need a bundled golden scan, which the spec rules out of scope.
2. **The landing composition stays** as the horizon hero:
   - status pill, headline, persona rows
   - the form on its dusk pool in the left column
   - the device frame on the right
   - the how-it-works accordion, then a list card

   What changes:
   - The URL + task `RunForm` and "Suggest tasks" are replaced by `ScanForm`: one large mono URL field (56px, `h-14`, 16px) and one white **Scan & test** pill (also 56px). They sit side by side from `sm`, stacked below it.
   - The spec says "centered". The field stays in the hero's left column, because the Horizon Hero signature puts the form there.
   - The "No site handy? Replay the golden run / Stream it over SSE" row stays.
   - The how-it-works copy is rewritten for scans.
   - "Recent runs" becomes **Recent scans** (`#scans`), with the same list card and clickable rows.
   - The status pill is kept.
3. **Headline:** the user chose **"Autonomous QA that finds the flaw, writes the fix, and opens the PR"** (2026-09-19). Use it verbatim. PRODUCT.md and DESIGN.md are updated to match in Task 9. The h1 size drops to `clamp(40px,5.2vw,64px)` because the headline is longer.
4. **Nav.** The spec's "logo-only header" maps onto the redesign's `Nav`, whose contract needs one white pill.
   - **Scan page:** logo, wordmark and a white **New scan** pill (both go home), with no tabs.
   - **Run views:** the "New run" pill becomes **New scan**, because the home page now starts scans.
   - **Landing:** links to "How it works" and "Recent scans", plus the white "Watch the demo" pill.
5. **Canvas and nodes.**
   - **Canvas:**
     - a `rounded-card border-hairline/10` frame on void
     - a 12% hairline dot grid, 24px apart
     - React Flow in `colorMode="dark"`, with its background made transparent
   - **Nodes:**
     - Every node is an opaque `bg-graphite` button, the same tone as a 4% card, so the grid never shows through.
     - Hover lifts the text to white and a neutral border to 40%.
     - Selected: `aria-current="true"`, a full hairline border on neutral nodes, and a 1px white ring set 4px off the edge (`ring-1 ring-white ring-offset-4 ring-offset-void`). This stays distinct from the 2px focus outline.
   - **Site node** (`w-65`, `rounded-card`):
     - status `Chip` and the host in Geist
     - while crawling: the progress message and "N pages read"
     - once tasks exist: verdict counts with status lights, issue totals and runs done
     - the failure message in coral; the generic-tasks notice in amber
   - **Task node** (`w-70 h-28`, `rounded-2xl`):
     - rank `T3` in mono ash, and the task title clamped to 2 lines
     - a mark strip: white `Check` for succeeded; a new `Cross` icon, coral for failed and amber for timed out; the running glow dot; the idle slate light
     - the finding count
     - the 1px border takes `SEVERITY_STYLES[worst].box`, or a 15% hairline when nothing was found
   - **Persona node** (`w-84 h-11`, `rounded-full` pill):
     - the white glyph tile and the short name ("Impatient", "Cautious", "Keyboard")
     - mono "7/15" steps
     - the finding count beside one dot in the worst severity's hue (slate at 0)
     - `StateBadge` with idle shown as **Queued**
   - **Edges:** 18% hairline. The edge into a running persona is a moving dash in 70% white (never violet), frozen under reduced motion.
   - **Zoom controls:** instead of React Flow's `<Controls>`, a graphite pill with ghost buttons for zoom in (`Plus`), zoom out (new `Minus`) and **Fit**.
6. **Side panel.** No wrapper card: a column of dusk cards on void.
   - **Site report:**
     - verdict tiles
     - "tasks completed, by persona" ("2 of 10")
     - the Severity Spectrum redrawn as five equal columns, because the report's 104px-minimum bars overflow 460px
     - issue cards styled like the report's finding cards, with `SeverityBadge withLabel`, the reach line, "Fix:" and occurrence chips as 28px ghost pills
   - **Notices:** the 3% "finished summary" box with a status light: partial (glow), mock/fallback (amber), failed (coral).
   - **Reconnecting banner:** the redesign's glass notice pill, with a breathing amber light.
   - **Persona panel:** the real `PersonaColumn` (`lg:h-160` from `lg`, so its own pane scrolls; natural height below), then evidence cards.
7. **Removed.**
   - `RunForm.tsx` (and with it the `StartedRun` fallback chain and the "Suggest tasks" UI)
   - the `api.startRun`, `api.createRunOnWorker`, `api.suggestTasks` and `api.listRuns` client calls (the landing no longer lists runs)
   - the `Wand` icon, which only RunForm used
   - the `startNotice` state in `App.tsx`
   - `.impeccable/design.json` is generated by the impeccable tooling from DESIGN.md, so it is not hand-edited here.
8. **Report refresh.** The refresh key also includes the number of finished runs, so the verdict tiles never lag behind the tree. The spec's triggers (total findings, status, task count) are all still in the key.

## Before Task 6

- [ ] **Confirm the workspace.** Run in Git Bash:

  ```bash
  cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && git branch --show-current && git status --short && git log --oneline -1
  ```

  Expected:
  - the branch is `feat/site-scan`
  - no status lines
  - the latest commit is `636fe5c chore: untrack the accidentally committed worktree gitlink…` or a later commit

- [ ] **Check the baseline.** Run: `pnpm --filter @friction/control-room typecheck`. Expected: exit 0.

## File Map

| File | Task | Status | Responsibility |
| --- | --- | --- | --- |
| `apps/control-room/src/lib/api.ts` | 6, 8 | modify | Task 6 adds the scan calls; Task 8 removes the run-start, suggest and list-runs calls |
| `apps/control-room/src/lib/useQuery.ts` | 6 | modify | `scan` and `node` in the URL |
| `apps/control-room/src/lib/scan.ts` | 6 | create | scan UI helpers: labels, tones, counts, node resolution |
| `apps/control-room/src/hooks/useScan.ts` | 6 | create | poll the tree |
| `apps/control-room/src/hooks/useScanReport.ts` | 6 | create | fetch the merged report |
| `apps/control-room/src/components/badges.tsx` | 6 | modify | `StateBadge` gains `idleLabel` |
| `apps/control-room/src/components/PersonaColumn.tsx` | 6 | modify | optional `idleLabel` passed to its `StateBadge` |
| `apps/control-room/src/components/icons.tsx` | 6, 8 | modify | Task 6 adds `Cross` and `Minus`; Task 8 removes `Wand` |
| `apps/control-room/src/components/scan/Notice.tsx` | 6 | create | 3% notice box with a status light |
| `apps/control-room/src/components/scan/IssueCard.tsx` | 6 | create | one merged issue |
| `apps/control-room/src/components/scan/RootPanel.tsx` | 6 | create | site report, crawl progress, crawled pages |
| `apps/control-room/src/components/scan/TaskPanel.tsx` | 6 | create | one task |
| `apps/control-room/src/components/scan/PersonaPanel.tsx` | 6 | create | one persona run, live |
| `apps/control-room/src/components/scan/SidePanel.tsx` | 6 | create | picks the panel for the node |
| `apps/control-room/package.json`, `pnpm-lock.yaml` | 7 | modify | `@xyflow/react` |
| `apps/control-room/src/lib/scanLayout.ts` | 7 | create | tree → React Flow nodes and edges (pure) |
| `apps/control-room/src/components/scan/nodes.tsx` | 7 | create | `RootNode`, `TaskNode`, `PersonaNode` |
| `apps/control-room/src/components/scan/ScanGraph.tsx` | 7 | create | the canvas |
| `apps/control-room/src/components/scan/ScanBar.tsx` | 7 | create | the top bar |
| `apps/control-room/src/components/scan/ScanPage.tsx` | 7 | create | page composition |
| `apps/control-room/src/index.css` | 7 | modify | unlayered `.scan-flow` overrides |
| `apps/control-room/src/App.tsx` | 7, 8 | modify | Task 7 adds the scan route; Task 8 gives the final form |
| `apps/control-room/src/components/ScanForm.tsx` | 8 | create | one field and one button |
| `apps/control-room/src/components/RunForm.tsx` | 8 | delete | replaced by ScanForm |
| `apps/control-room/src/components/Landing.tsx` | 8 | modify | scan hero, how it works, recent scans |
| `apps/control-room/src/lib/config.ts` | 8 | modify | comment only |
| `apps/control-room/index.html` | 8 | modify | design-thesis comment only |
| `README.md`, `SETUP.md`, `.env.example` | 9 | modify | scans, `MAX_SESSIONS`, time and cost |
| `apps/control-room/PRODUCT.md`, `apps/control-room/DESIGN.md` | 9 | modify | scan flow in the product and design docs |

---

### Task 6: Control room — scan data layer and side panels

**Files:**
- Modify: `apps/control-room/src/lib/api.ts` (import block; add 4 calls)
- Modify: `apps/control-room/src/lib/useQuery.ts` (full replacement)
- Create: `apps/control-room/src/lib/scan.ts`
- Create: `apps/control-room/src/hooks/useScan.ts`
- Create: `apps/control-room/src/hooks/useScanReport.ts`
- Modify: `apps/control-room/src/components/badges.tsx` (`StateBadge`)
- Modify: `apps/control-room/src/components/PersonaColumn.tsx` (3 small edits)
- Modify: `apps/control-room/src/components/icons.tsx` (add `Cross`, `Minus`)
- Create: `apps/control-room/src/components/scan/Notice.tsx`
- Create: `apps/control-room/src/components/scan/IssueCard.tsx`
- Create: `apps/control-room/src/components/scan/RootPanel.tsx`
- Create: `apps/control-room/src/components/scan/TaskPanel.tsx`
- Create: `apps/control-room/src/components/scan/PersonaPanel.tsx`
- Create: `apps/control-room/src/components/scan/SidePanel.tsx`

**Interfaces:**
- **Consumes, `@friction/shared` (Tasks 1–2, as they exist):**
  - types: `ScanTreeResponse`, `ScanTreeTask`, `ScanTreePersona`, `ScanReportResponse`, `ScanIssue`, `ScanListResponse`, `CreateScanResponse`, `ScanNode`, `ScanStatus`, `TaskVerdict`, `CrawledPage`, `PersonaId`, `PersonaState`, `Severity`
  - functions: `parseScanNode(id: string | null | undefined): ScanNode`, `scanNodeId(node: ScanNode): string`, `taskVerdict(states: readonly PersonaState[]): TaskVerdict`, `isScanFinished(status: ScanStatus): boolean`, `isTerminalState(state: PersonaState): boolean`
  - constants: `PERSONAS`, `PERSONA_BY_ID`, `FRICTION_LABELS`, `SEVERITY_LABELS`
  - `ScanIssue` fields: `key, category, severity, confidence, summary, whyItMatters, recommendation, page, targetLabel, runsHit, totalRuns, personas, taskIndexes, occurrences[{ runId, taskIndex, personaId, evidenceSeq, severity }], evidence: ReportEvidence | null`
  - `ScanReportResponse.summary`: `{ verdicts: Record<TaskVerdict, number>; personas: Record<PersonaId, { succeeded; finished; total }>; issuesBySeverity: Record<Severity, number> }`
- **Consumes, Worker (Task 3):**
  - `GET /api/scans?limit=` → `ScanListResponse`
  - `GET /api/scans/:id` → `ScanTreeResponse`, or `404 { error }`
  - `GET /api/scans/:id/report` → `ScanReportResponse`
- **Consumes, orchestrator (Task 5):** `POST /scans { url }` → `201 { scanId }`, `400 { error }` or `502 { error }`
- **Consumes, redesign (as it is now):**
  - from `badges.tsx`: `Chip({ children, tone? })`, `Dot({ tone, size?, pulse? })`, `type Tone = "idle" | "glow" | "good" | "warn" | "bad"`, `SEVERITY_STYLES[sev]` with `{ text, dot, box, ring }`, `SeverityBadge({ severity, withLabel? })`, `StateBadge({ state, prefix? })`, `categoryLabel(category)`
  - `EvidenceImage({ source: { screenshotKey, bbox, viewport?, payload? }, boxClass?, label?, className? })`
  - `PersonaColumn({ persona, allowLiveView, startTs })`
  - `useRunStream(runId, { replay }): RunStream`, which gives `view.personas[id]`, `view.firstTs`, `origin` and `notice`
  - `pathOf(url)`
  - icons: `ArrowLeft`, `ArrowRight`, `Check`, `Plus`, `PERSONA_GLYPHS`
- **Produces:**
  - **API calls:** `api.startScan(url: string): Promise<CreateScanResponse>`, `api.listScans(): Promise<ScanListResponse>`, `api.getScanTree(scanId: string): Promise<ScanTreeResponse>`, `api.getScanReport(scanId: string): Promise<ScanReportResponse>`
  - **Query:** `Query.scan: string | null`, `Query.node: string | null`
  - **`lib/scan.ts`:**
    - `personaShortName(id: PersonaId): string`
    - `hostOf(url: string): string`
    - `SCAN_STATUS: Record<ScanStatus, { label: string; tone: Tone }>`
    - `VERDICT: Record<TaskVerdict, { label: string; tone: Tone }>`
    - `VERDICT_ORDER: readonly TaskVerdict[]`
    - `SCAN_STATE_LABELS: Record<PersonaState, string>`
    - `runProgress(tree): { done: number; total: number }`
    - `totalFindings(tree): number`
    - `worstSeverity(personas: readonly ScanTreePersona[]): Severity | null`
    - `verdictCounts(tree): Record<TaskVerdict, number>`
    - `resolveScanNode(node: ScanNode, tree: ScanTreeResponse): ScanNode`
  - **Hooks:**
    - `useScan(scanId: string): ScanPoll`, where `ScanPoll = { tree: ScanTreeResponse | null; stale: boolean; missing: boolean }`
    - `SCAN_POLL_MS = 2000`
    - `useScanReport(scanId: string, refreshKey: string): { report: ScanReportResponse | null; loading: boolean }`
  - **Component props:**
    - `StateBadge({ state, prefix?, idleLabel? })`
    - `PersonaColumn({ persona, allowLiveView, startTs, idleLabel? })`
    - icons `Cross`, `Minus`
    - `Notice({ tone: Tone; children })`
    - `IssueCard({ issue: ScanIssue; rank: number; onSelect: (nodeId: string) => void })`
    - `RootPanel({ tree, report, onSelect })`
    - `TaskPanel({ task: ScanTreeTask; report; onSelect; onOpenRun: (runId: string) => void })`
    - `PersonaPanel({ task: ScanTreeTask; personaId: PersonaId; onSelect })`
    - `SidePanel({ tree: ScanTreeResponse; report: ScanReportResponse | null; node: ScanNode; onSelect: (nodeId: string) => void; onOpenRun: (runId: string) => void })`

The control room has no test runner, so this task is verified by typecheck. The panels are exercised in the browser in Task 7.

- [ ] **Step 1: Add the scan calls to `apps/control-room/src/lib/api.ts`**

Replace the import block at the top of the file:

```ts
import type {
  CreateRunRequest,
  CreateRunResponse,
  OrchestratorHealth,
  ReportResponse,
  RunListResponse,
  RunSnapshot,
  SuggestTasksResponse,
} from "@friction/shared";
```

with:

```ts
import type {
  CreateRunRequest,
  CreateRunResponse,
  CreateScanResponse,
  OrchestratorHealth,
  ReportResponse,
  RunListResponse,
  RunSnapshot,
  ScanListResponse,
  ScanReportResponse,
  ScanTreeResponse,
  SuggestTasksResponse,
} from "@friction/shared";
```

Then, inside `export const api = {`, directly after the `orchestratorHealth: …` line, insert:

```ts

  /** Starts the crawl, task generation and every persona run in the background; answers with the scan id at once. */
  startScan: (url: string) => request<CreateScanResponse>(`${ORCHESTRATOR_URL}/scans`, json({ url }), 12_000),

  listScans: () => request<ScanListResponse>(`${WORKER_URL}/api/scans?limit=12`, undefined, 5000),
  getScanTree: (scanId: string) => request<ScanTreeResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}`, undefined, 6000),
  getScanReport: (scanId: string) =>
    request<ScanReportResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}/report`, undefined, 8000),
```

Leave everything else in the file unchanged. Task 8 removes the calls nothing uses.

- [ ] **Step 2: Replace `apps/control-room/src/lib/useQuery.ts`**

```ts
import { useCallback, useEffect, useState } from "react";

export type Tab = "room" | "report";

export interface Query {
  run: string | null;
  scan: string | null;
  /** Selected node on the scan canvas ("t2", "t2.keyboard"); null means the site root. */
  node: string | null;
  replay: boolean;
  tab: Tab;
}

function read(): Query {
  const params = new URLSearchParams(window.location.search);
  return {
    run: params.get("run") || null,
    scan: params.get("scan") || null,
    node: params.get("node") || null,
    replay: params.get("replay") === "1",
    tab: params.get("tab") === "report" ? "report" : "room",
  };
}

/** A scan wins over a run: ?scan= never carries run parameters, and ?run= never carries a node. */
function write(query: Query): string {
  const params = new URLSearchParams();
  if (query.scan) {
    params.set("scan", query.scan);
    if (query.node && query.node !== "root") params.set("node", query.node);
  } else if (query.run) {
    params.set("run", query.run);
    if (query.replay) params.set("replay", "1");
    if (query.tab === "report") params.set("tab", "report");
  }
  const search = params.toString();
  return search ? `?${search}` : window.location.pathname;
}

/**
 * The URL is the app state: ?scan=<id>[&node=<id>] for a scan, or
 * ?run=<id>[&replay=1][&tab=report] for a single run. That keeps every view
 * linkable (handy when the demo laptop needs a specific view, fast) and makes
 * the back button behave.
 */
export function useQuery(): [Query, (patch: Partial<Query>) => void] {
  const [query, setQuery] = useState<Query>(read);

  useEffect(() => {
    const onPop = (): void => setQuery(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = useCallback((patch: Partial<Query>) => {
    const next = { ...read(), ...patch };
    window.history.pushState(null, "", write(next));
    setQuery(next);
  }, []);

  return [query, update];
}
```

- [ ] **Step 3: Create `apps/control-room/src/lib/scan.ts`**

```ts
/** Small, pure helpers the scan page, its nodes and its panels share. */
import {
  PERSONA_BY_ID,
  isTerminalState,
  taskVerdict,
  type PersonaId,
  type PersonaState,
  type ScanNode,
  type ScanStatus,
  type ScanTreePersona,
  type ScanTreeResponse,
  type Severity,
  type TaskVerdict,
} from "@friction/shared";
import type { Tone } from "../components/badges";

/** "Impatient power user" -> "Impatient", "Keyboard-only user" -> "Keyboard". */
export function personaShortName(id: PersonaId): string {
  return PERSONA_BY_ID[id].displayName.split(/[\s-]/)[0] ?? id;
}

/** "https://www.shop.example/x" -> "shop.example" */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Status lights follow DESIGN.md: running is the violet glow, done is white, failure is coral. */
export const SCAN_STATUS: Readonly<Record<ScanStatus, { label: string; tone: Tone }>> = {
  crawling: { label: "Crawling", tone: "glow" },
  running: { label: "Running", tone: "glow" },
  completed: { label: "Completed", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
};

export const VERDICT: Readonly<Record<TaskVerdict, { label: string; tone: Tone }>> = {
  pass: { label: "Pass", tone: "good" },
  partial: { label: "Partial", tone: "warn" },
  fail: { label: "Fail", tone: "bad" },
  pending: { label: "Pending", tone: "idle" },
};

export const VERDICT_ORDER: readonly TaskVerdict[] = ["pass", "partial", "fail", "pending"];

/** In a scan, an idle persona is waiting for a browser session: it reads as "Queued". */
export const SCAN_STATE_LABELS: Readonly<Record<PersonaState, string>> = {
  idle: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  timeout: "Timed out",
};

/** Persona runs finished vs. total. */
export function runProgress(tree: ScanTreeResponse): { done: number; total: number } {
  const personas = tree.tasks.flatMap((task) => task.personas);
  return { done: personas.filter((p) => isTerminalState(p.state)).length, total: personas.length };
}

export function totalFindings(tree: ScanTreeResponse): number {
  return tree.tasks.reduce((sum, task) => sum + task.personas.reduce((inner, p) => inner + p.findingCount, 0), 0);
}

export function worstSeverity(personas: readonly ScanTreePersona[]): Severity | null {
  return personas.reduce<Severity | null>(
    (worst, p) => (p.worstSeverity !== null && (worst === null || p.worstSeverity > worst) ? p.worstSeverity : worst),
    null,
  );
}

export function verdictCounts(tree: ScanTreeResponse): Record<TaskVerdict, number> {
  const counts: Record<TaskVerdict, number> = { pass: 0, partial: 0, fail: 0, pending: 0 };
  for (const task of tree.tasks) counts[taskVerdict(task.personas.map((p) => p.state))] += 1;
  return counts;
}

/** A node whose task does not exist (yet) is the root, as the spec says. */
export function resolveScanNode(node: ScanNode, tree: ScanTreeResponse): ScanNode {
  if (node.kind === "root") return node;
  return tree.tasks.some((task) => task.index === node.index) ? node : { kind: "root" };
}
```

- [ ] **Step 4: Create `apps/control-room/src/hooks/useScan.ts`**

```ts
import { useEffect, useState } from "react";
import { isScanFinished, type ScanTreeResponse } from "@friction/shared";
import { ApiError, api } from "../lib/api";

/** How often the tree is polled while the scan is going. */
export const SCAN_POLL_MS = 2000;

export interface ScanPoll {
  tree: ScanTreeResponse | null;
  /** The latest poll failed; `tree` is the last one that worked. Polling continues. */
  stale: boolean;
  /** The Worker says this scan does not exist. Nothing to retry. */
  missing: boolean;
}

/**
 * Polls GET /api/scans/:id every 2s until the scan completes or fails. One
 * small request per poll; the selected persona node streams on its own.
 */
export function useScan(scanId: string): ScanPoll {
  const [state, setState] = useState<ScanPoll>({ tree: null, stale: false, missing: false });

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setState({ tree: null, stale: false, missing: false });

    const poll = async (): Promise<void> => {
      try {
        const tree = await api.getScanTree(scanId);
        if (cancelled) return;
        setState({ tree, stale: false, missing: false });
        if (isScanFinished(tree.scan.status)) return;
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ tree: null, stale: false, missing: true });
          return;
        }
        setState((previous) => ({ ...previous, stale: true }));
      }
      timer = window.setTimeout(() => void poll(), SCAN_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scanId]);

  return state;
}
```

- [ ] **Step 5: Create `apps/control-room/src/hooks/useScanReport.ts`**

```ts
import { useEffect, useState } from "react";
import type { ScanReportResponse } from "@friction/shared";
import { api } from "../lib/api";

/**
 * The merged site report. Refetched whenever `refreshKey` changes (the scan
 * page derives it from findings, finished runs, task count and status). A
 * failed fetch keeps the last report on screen.
 */
export function useScanReport(scanId: string, refreshKey: string): { report: ScanReportResponse | null; loading: boolean } {
  const [report, setReport] = useState<ScanReportResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setReport(null);
  }, [scanId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getScanReport(scanId)
      .then((body) => {
        if (!cancelled) setReport(body);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId, refreshKey]);

  return { report, loading };
}
```

- [ ] **Step 6: Give `StateBadge` an `idleLabel` in `apps/control-room/src/components/badges.tsx`**

Replace the whole `StateBadge` function:

```tsx
export function StateBadge({ state, prefix }: { state: PersonaState; prefix?: string }) {
  const style = STATE_STYLES[state];
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-2 rounded-full border border-hairline/15 px-3 text-caption text-bone">
      <Dot tone={style.tone} />
      {prefix ? (
        <span>
          {prefix} <span className="text-smoke">{style.label}</span>
        </span>
      ) : (
        style.label
      )}
    </span>
  );
}
```

with:

```tsx
/** `idleLabel` renames the idle state where waiting means something else (a scan's queued personas). */
export function StateBadge({ state, prefix, idleLabel }: { state: PersonaState; prefix?: string; idleLabel?: string }) {
  const style = STATE_STYLES[state];
  const label = state === "idle" && idleLabel ? idleLabel : style.label;
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-2 rounded-full border border-hairline/15 px-3 text-caption text-bone">
      <Dot tone={style.tone} />
      {prefix ? (
        <span>
          {prefix} <span className="text-smoke">{label}</span>
        </span>
      ) : (
        label
      )}
    </span>
  );
}
```

- [ ] **Step 7: Let `PersonaColumn` pass an `idleLabel` through**

Make three edits in `apps/control-room/src/components/PersonaColumn.tsx`.

1. In `interface Props`, after the `startTs: number | null;` line, add:

   ```ts
     /** Label for the idle state; a scan shows its queued personas as "Queued". */
     idleLabel?: string;
   ```

2. Replace `export function PersonaColumn({ persona, allowLiveView, startTs }: Props) {` with:

   ```tsx
   export function PersonaColumn({ persona, allowLiveView, startTs, idleLabel }: Props) {
   ```

3. Replace `<StateBadge state={persona.state} />` (in the header) with:

   ```tsx
   <StateBadge state={persona.state} idleLabel={idleLabel} />
   ```

- [ ] **Step 8: Add `Cross` and `Minus` to `apps/control-room/src/components/icons.tsx`**

Directly after the `Plus` icon (the block ending `<path d="M10 4v12M4 10h12" />` … `);`), insert:

```tsx

/** A persona that failed or timed out, on a task node's mark strip. */
export const Cross = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Icon>
);

export const Minus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10h12" />
  </Icon>
);
```

- [ ] **Step 9: Create `apps/control-room/src/components/scan/Notice.tsx`**

```tsx
import { Dot, type Tone } from "../badges";

/** What is on screen, and why: a 3% box with its status light, like a finished persona's summary. */
export function Notice({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-ui border border-hairline/10 bg-white/3 px-3 py-2 text-ui leading-snug text-bone">
      <span className="mt-1.5 flex">
        <Dot tone={tone} size={7} />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
```

- [ ] **Step 10: Create `apps/control-room/src/components/scan/IssueCard.tsx`**

```tsx
import { FRICTION_LABELS, scanNodeId, type ScanIssue } from "@friction/shared";
import { personaShortName } from "../../lib/scan";
import { EvidenceImage } from "../EvidenceImage";
import { SEVERITY_STYLES, SeverityBadge, categoryLabel } from "../badges";

interface Props {
  issue: ScanIssue;
  /** 1-based position in the site report's ranking. */
  rank: number;
  onSelect: (nodeId: string) => void;
}

/** One merged issue: how bad, how widespread, the evidence, and every run that hit it. */
export function IssueCard({ issue, rank, onSelect }: Props) {
  const style = SEVERITY_STYLES[issue.severity];
  // One chip per task x persona run, even when that run hit the issue more than once.
  const runs = [...new Map(issue.occurrences.map((o) => [`${o.taskIndex}.${o.personaId}`, o] as const)).values()];
  const tasks = issue.taskIndexes.length;

  return (
    <article className="overflow-hidden rounded-card border border-hairline/10 bg-white/4">
      <div className="p-3 pb-0">
        {issue.evidence ? (
          <div className="overflow-hidden rounded-xl">
            <EvidenceImage
              source={{ screenshotKey: issue.evidence.screenshotKey, bbox: issue.evidence.bbox, viewport: issue.evidence.viewport }}
              boxClass={style.box}
              label={issue.evidence.targetLabel}
            />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl bg-graphite px-6 text-center text-caption text-smoke">
            The evidence step was never received.
          </div>
        )}
      </div>

      <div className="px-5 pb-5 pt-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-heading text-subheading tabular-nums leading-none text-ash">{String(rank).padStart(2, "0")}</span>
          <SeverityBadge severity={issue.severity} withLabel />
        </div>
        <h3 className="mt-3 font-heading text-subheading text-white" title={FRICTION_LABELS[issue.category].blurb}>
          {categoryLabel(issue.category)}
        </h3>
        <p className="mt-1 text-caption text-smoke">
          Hit in{" "}
          <span className="tabular-nums text-bone">
            {issue.runsHit}/{issue.totalRuns}
          </span>{" "}
          runs · {tasks} {tasks === 1 ? "task" : "tasks"} · {issue.personas.map(personaShortName).join(", ")}
          {issue.page && (
            <>
              {" · "}
              <span className="font-mono tracking-normal">{issue.page}</span>
            </>
          )}
        </p>
        {issue.summary && <p className="mt-3 text-ui leading-snug text-bone">{issue.summary}</p>}
        {issue.whyItMatters && <p className="mt-1.5 text-ui text-ash">{issue.whyItMatters}</p>}
        <p className="mt-3 rounded-ui border border-hairline/15 px-3 py-2 text-ui text-ash">
          <span className="text-bone">Fix: </span>
          {issue.recommendation}
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Runs that hit this issue">
          {runs.map((o) => (
            <button
              key={`${o.taskIndex}.${o.personaId}`}
              type="button"
              onClick={() => onSelect(scanNodeId({ kind: "persona", index: o.taskIndex, personaId: o.personaId }))}
              className="pill-ghost h-7 px-2.5 text-caption tabular-nums"
            >
              T{o.taskIndex + 1} · {personaShortName(o.personaId)}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 11: Create `apps/control-room/src/components/scan/RootPanel.tsx`**

```tsx
import {
  PERSONAS,
  SEVERITY_LABELS,
  isScanFinished,
  type CrawledPage,
  type ScanReportResponse,
  type ScanTreeResponse,
  type Severity,
} from "@friction/shared";
import { pathOf } from "../../lib/format";
import { VERDICT, VERDICT_ORDER, hostOf, runProgress } from "../../lib/scan";
import { Dot, SEVERITY_STYLES } from "../badges";
import { PERSONA_GLYPHS, Plus } from "../icons";
import { IssueCard } from "./IssueCard";
import { Notice } from "./Notice";

interface Props {
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  onSelect: (nodeId: string) => void;
}

const SEVERITIES: Severity[] = [5, 4, 3, 2, 1];

/** The site node's panel: crawl progress while reading, then the merged site report. */
export function RootPanel({ tree, report, onSelect }: Props) {
  const { scan } = tree;
  const hasTasks = tree.tasks.length > 0;
  const progress = runProgress(tree);
  // While running, the message is the task-source note, which the notices below already say.
  const showMessage = scan.message !== null && (scan.status === "crawling" || scan.status === "completed");

  return (
    <div className="space-y-5">
      <header>
        <p className="text-caption text-smoke">Site report</p>
        <h2 className="mt-1 truncate font-heading text-heading-sm font-medium tracking-[-0.02em] text-white" title={scan.url}>
          {hostOf(scan.url)}
        </h2>
        {showMessage && <p className="mt-1.5 text-ui text-ash">{scan.message}</p>}
      </header>

      {scan.status === "failed" && <Notice tone="bad">{scan.message ?? "The scan failed."}</Notice>}
      {scan.taskSource === "fallback" && <Notice tone="warn">Couldn't read the site; these tasks are generic.</Notice>}
      {scan.taskSource === "mock" && (
        <Notice tone="warn">Mock scan: no API keys, so the tasks are canned and every run replays the golden run.</Notice>
      )}
      {hasTasks && !isScanFinished(scan.status) && (
        <Notice tone="glow">
          Partial report: {progress.done} of {progress.total} runs have finished. Issues fill in as the rest do.
        </Notice>
      )}

      {!hasTasks ? (
        <PageList
          pages={scan.pages}
          title={scan.status === "failed" ? "Pages read before the scan failed" : "Pages read so far"}
          reading={scan.status === "crawling"}
        />
      ) : report ? (
        <ReportBody report={report} onSelect={onSelect} />
      ) : (
        <div className="flex flex-col items-center gap-4 py-10 text-body text-smoke" aria-busy="true">
          <div className="wash wash-sweep h-px w-56" aria-hidden="true" />
          Building the report…
        </div>
      )}

      {hasTasks && scan.pages.length > 0 && (
        <details className="group rounded-card border border-hairline/10 bg-white/4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-4 text-ui text-bone transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
            <span>
              Crawled pages <span className="tabular-nums text-smoke">{scan.pages.length}</span>
            </span>
            <Plus size={14} className="shrink-0 text-ash transition-transform duration-300 ease-out group-open:rotate-45" />
          </summary>
          <PageItems pages={scan.pages} className="border-t border-hairline/10" />
        </details>
      )}
    </div>
  );
}

function PageList({ pages, title, reading }: { pages: CrawledPage[]; title: string; reading: boolean }) {
  return (
    <section aria-label={title}>
      <h3 className="text-caption text-ash">
        {title} <span className="tabular-nums text-smoke">{pages.length}</span>
      </h3>
      {pages.length === 0 ? (
        <div className="mt-3 flex flex-col items-center gap-4 rounded-card border border-hairline/10 bg-white/4 px-6 py-10 text-body text-smoke">
          {reading && <div className="wash wash-sweep h-px w-56" aria-hidden="true" />}
          {reading ? "Opening the site…" : "No pages were read."}
        </div>
      ) : (
        <PageItems pages={pages} className="mt-3 rounded-card border border-hairline/10 bg-white/4" />
      )}
      {reading && pages.length > 0 && <div className="wash wash-sweep mt-3 h-px w-full" aria-hidden="true" />}
    </section>
  );
}

function PageItems({ pages, className = "" }: { pages: CrawledPage[]; className?: string }) {
  return (
    <ul className={`divide-y divide-hairline/10 ${className}`}>
      {pages.map((page) => (
        <li key={page.url} className="step-in px-5 py-3">
          <span className="block truncate text-ui text-bone">{page.title || "Untitled page"}</span>
          <span className="mt-0.5 block truncate font-mono text-caption tracking-normal text-smoke" title={page.url}>
            {pathOf(page.url)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReportBody({ report, onSelect }: { report: ScanReportResponse; onSelect: (nodeId: string) => void }) {
  const { summary } = report;
  return (
    <>
      <section aria-label="Summary" className="rounded-card border border-hairline/10 bg-white/4 p-5">
        <h3 className="text-caption text-ash">Tasks</h3>
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {VERDICT_ORDER.map((verdict) => (
            <li key={verdict} className="rounded-ui border border-hairline/10 px-3 py-2.5">
              <span className="block text-heading-sm tabular-nums leading-none text-white">{summary.verdicts[verdict]}</span>
              <span className="mt-2 flex items-center gap-1.5 text-caption text-smoke">
                <Dot tone={VERDICT[verdict].tone} size={6} />
                {VERDICT[verdict].label}
              </span>
            </li>
          ))}
        </ul>

        <h3 className="mt-5 text-caption text-ash">Tasks completed, by persona</h3>
        <ul className="mt-2 space-y-2">
          {PERSONAS.map((persona) => {
            const stats = summary.personas[persona.id];
            const Glyph = PERSONA_GLYPHS[persona.id];
            return (
              <li key={persona.id} className="flex items-center gap-3 text-ui">
                <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-icon bg-white text-black">
                  <Glyph size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate text-bone">{persona.displayName}</span>
                <span className="shrink-0 tabular-nums text-smoke">
                  <span className="text-white">{stats.succeeded}</span> of {stats.total}
                </span>
              </li>
            );
          })}
        </ul>

        <h3 className="mt-5 text-caption text-ash">Issues by severity</h3>
        <ul className="mt-2 grid grid-cols-5 gap-1.5">
          {SEVERITIES.map((severity) => {
            const count = summary.issuesBySeverity[severity];
            return (
              <li key={severity} className="min-w-0" title={`Severity ${severity} of 5`}>
                <span aria-hidden="true" className={`block h-2 rounded-full ${count > 0 ? SEVERITY_STYLES[severity].dot : "bg-hairline/10"}`} />
                <span className="mt-2 block text-subheading tabular-nums leading-none text-white">{count}</span>
                <span className={`mt-1 block truncate text-caption ${count > 0 ? SEVERITY_STYLES[severity].text : "text-smoke"}`}>
                  {SEVERITY_LABELS[severity]}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Issues">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-heading text-subheading text-bone">
            Issues <span className="tabular-nums text-smoke">{report.issues.length}</span>
          </h3>
          <p className="text-caption text-smoke">By severity, then reach</p>
        </div>
        <div className="mt-3 space-y-4">
          {report.issues.length === 0 && (
            <p className="rounded-card border border-dashed border-hairline/20 px-6 py-10 text-center text-body text-smoke">No friction found yet.</p>
          )}
          {report.issues.map((issue, index) => (
            <IssueCard key={issue.key} issue={issue} rank={index + 1} onSelect={onSelect} />
          ))}
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 12: Create `apps/control-room/src/components/scan/TaskPanel.tsx`**

```tsx
import { PERSONA_BY_ID, scanNodeId, taskVerdict, type ScanReportResponse, type ScanTreeTask } from "@friction/shared";
import { VERDICT } from "../../lib/scan";
import { Chip, StateBadge } from "../badges";
import { ArrowRight, PERSONA_GLYPHS } from "../icons";
import { IssueCard } from "./IssueCard";

interface Props {
  task: ScanTreeTask;
  report: ScanReportResponse | null;
  onSelect: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

/** One task: what it is, why it matters, how its three personas did, and the issues it hit. */
export function TaskPanel({ task, report, onSelect, onOpenRun }: Props) {
  const verdict = VERDICT[taskVerdict(task.personas.map((p) => p.state))];
  const ranked = report
    ? report.issues.map((issue, index) => ({ issue, rank: index + 1 })).filter(({ issue }) => issue.taskIndexes.includes(task.index))
    : [];

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-caption tabular-nums tracking-normal text-ash">T{task.index + 1}</span>
          <Chip tone={verdict.tone}>{verdict.label}</Chip>
        </div>
        <h2 className="mt-2 font-heading text-heading-sm font-medium tracking-[-0.02em] text-white">{task.title}</h2>
      </header>

      <dl className="space-y-3">
        <div>
          <dt className="text-caption text-smoke">Why it's critical</dt>
          <dd className="mt-1 text-body text-ash">{task.whyCritical}</dd>
        </div>
        <div>
          <dt className="text-caption text-smoke">Success looks like</dt>
          <dd className="mt-1 text-body text-ash">{task.successCheck}</dd>
        </div>
      </dl>

      <section aria-label="Personas">
        <h3 className="text-caption text-ash">Personas</h3>
        <ul className="mt-2 overflow-hidden rounded-card border border-hairline/10 bg-white/4">
          {task.personas.map((p) => {
            const Glyph = PERSONA_GLYPHS[p.personaId];
            return (
              <li key={p.personaId} className="border-b border-hairline/10 last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSelect(scanNodeId({ kind: "persona", index: task.index, personaId: p.personaId }))}
                  className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/3"
                >
                  <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-icon bg-white text-black">
                    <Glyph size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui text-bone group-hover:text-white">{PERSONA_BY_ID[p.personaId].displayName}</span>
                    <span className="block text-caption tabular-nums text-smoke">
                      {p.stepCount} steps · {p.findingCount} {p.findingCount === 1 ? "finding" : "findings"}
                    </span>
                  </span>
                  <StateBadge state={p.state} idleLabel="Queued" />
                </button>
              </li>
            );
          })}
        </ul>
        {/* A real link, so it opens in a new tab too; a plain click stays in the app. */}
        <a
          href={`?run=${encodeURIComponent(task.runId)}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            onOpenRun(task.runId);
          }}
          className="pill-ghost mt-3"
        >
          Open full control room
          <ArrowRight size={14} />
        </a>
      </section>

      <section aria-label="Issues in this task">
        <h3 className="font-heading text-subheading text-bone">
          Issues in this task <span className="tabular-nums text-smoke">{ranked.length}</span>
        </h3>
        <div className="mt-3 space-y-4">
          {ranked.length === 0 && <p className="text-caption text-smoke">{report ? "None so far." : "Building the report…"}</p>}
          {ranked.map(({ issue, rank }) => (
            <IssueCard key={issue.key} issue={issue} rank={rank} onSelect={onSelect} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 13: Create `apps/control-room/src/components/scan/PersonaPanel.tsx`**

```tsx
import { isTerminalState, scanNodeId, type PersonaId, type ScanTreeTask } from "@friction/shared";
import { useRunStream } from "../../hooks/useRunStream";
import { EvidenceImage } from "../EvidenceImage";
import { PersonaColumn } from "../PersonaColumn";
import { SEVERITY_STYLES, SeverityBadge, categoryLabel } from "../badges";
import { ArrowLeft } from "../icons";
import { Notice } from "./Notice";

interface Props {
  task: ScanTreeTask;
  personaId: PersonaId;
  onSelect: (nodeId: string) => void;
}

/**
 * One persona run, live: the control room's own PersonaColumn on the run's SSE
 * stream, then this persona's findings with their screenshots. SidePanel keys
 * it by run id, so selecting a persona of another task opens that run's stream.
 */
export function PersonaPanel({ task, personaId, onSelect }: Props) {
  const stream = useRunStream(task.runId, { replay: false });
  const persona = stream.view.personas[personaId];
  const findings = [...persona.frictions].sort((a, b) => b.payload.severity - a.payload.severity || a.seq - b.seq);

  return (
    <div className="space-y-5">
      <header>
        <button type="button" onClick={() => onSelect(scanNodeId({ kind: "task", index: task.index }))} className="pill-ghost h-8 px-3 text-caption">
          <ArrowLeft size={13} />
          Back to T{task.index + 1}
        </button>
        <h2 className="mt-3 font-heading text-subheading text-white">{task.title}</h2>
      </header>

      {stream.notice && <Notice tone="warn">{stream.notice}</Notice>}

      {/* From lg the panel scrolls on its own, so the column gets a fixed height and scrolls its friction and timeline pane inside it. */}
      <div className="grid lg:h-160">
        <PersonaColumn persona={persona} allowLiveView={stream.origin === "live"} startTs={stream.view.firstTs} idleLabel="Queued" />
      </div>

      <section aria-label="Evidence">
        <h3 className="flex items-center gap-2 text-caption text-ash">
          Evidence
          <span className={`tabular-nums ${findings.length > 0 ? "text-sev-5" : "text-smoke"}`}>{findings.length}</span>
        </h3>
        {findings.length === 0 ? (
          <p className="mt-2 text-caption text-smoke">{isTerminalState(persona.state) ? "No friction was detected in this run." : "Nothing detected yet."}</p>
        ) : (
          <div className="mt-3 space-y-4">
            {findings.map((friction) => {
              const index = persona.steps.findIndex((step) => step.seq === friction.payload.evidenceSeq);
              const step = persona.steps[index];
              const style = SEVERITY_STYLES[friction.payload.severity];
              return (
                <article key={`${personaId}:${friction.seq}`} className="overflow-hidden rounded-card border border-hairline/10 bg-white/4">
                  <div className="p-3 pb-0">
                    {step ? (
                      <div className="overflow-hidden rounded-xl">
                        <EvidenceImage
                          source={{ screenshotKey: step.payload.screenshotKey, bbox: step.payload.bbox, viewport: step.payload.viewport, payload: step.payload }}
                          boxClass={style.box}
                          label={step.payload.targetLabel}
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-video items-center justify-center rounded-xl bg-graphite px-6 text-center text-caption text-smoke">
                        The evidence step was never received.
                      </div>
                    )}
                  </div>
                  <div className="px-5 pb-4 pt-3">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={friction.payload.severity} />
                      <h4 className={`min-w-0 truncate text-body ${style.text}`}>{categoryLabel(friction.payload.category)}</h4>
                      {index >= 0 && <span className="ml-auto shrink-0 text-caption tabular-nums text-smoke">step {index + 1}</span>}
                    </div>
                    {friction.payload.summary && <p className="mt-2 text-ui leading-snug text-bone">{friction.payload.summary}</p>}
                    <p className="mt-1.5 text-caption text-ash">
                      <span className="text-bone">Fix: </span>
                      {friction.payload.recommendation}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 14: Create `apps/control-room/src/components/scan/SidePanel.tsx`**

```tsx
import type { ScanNode, ScanReportResponse, ScanTreeResponse } from "@friction/shared";
import { PersonaPanel } from "./PersonaPanel";
import { RootPanel } from "./RootPanel";
import { TaskPanel } from "./TaskPanel";

interface Props {
  tree: ScanTreeResponse;
  report: ScanReportResponse | null;
  node: ScanNode;
  onSelect: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

/** The panel for the selected node. A node whose task does not exist (yet) falls back to the site report. */
export function SidePanel({ tree, report, node, onSelect, onOpenRun }: Props) {
  const task = node.kind === "root" ? undefined : tree.tasks.find((t) => t.index === node.index);
  if (node.kind === "persona" && task) {
    return <PersonaPanel key={task.runId} task={task} personaId={node.personaId} onSelect={onSelect} />;
  }
  if (node.kind === "task" && task) return <TaskPanel task={task} report={report} onSelect={onSelect} onOpenRun={onOpenRun} />;
  return <RootPanel tree={tree} report={report} onSelect={onSelect} />;
}
```

- [ ] **Step 15: Typecheck**

Run: `pnpm --filter @friction/control-room typecheck`
Expected: exit 0, with no output from `tsc`. Nothing renders the new files yet; Task 7 mounts them.

- [ ] **Step 16: Scan for palette classes that do not exist**

Run in Git Bash:

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && grep -rnE "(bg|text|border|ring|divide)-(slate|gray|zinc|neutral|red|amber|emerald|indigo|blue|green)-[0-9]" apps/control-room/src || echo "no reset-palette classes"
```

Expected: `no reset-palette classes`. `slate` alone, with no number, is a dusk token and does not match.

- [ ] **Step 17: Commit**

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && git add apps/control-room/src/lib/api.ts apps/control-room/src/lib/useQuery.ts apps/control-room/src/lib/scan.ts apps/control-room/src/hooks/useScan.ts apps/control-room/src/hooks/useScanReport.ts apps/control-room/src/components/badges.tsx apps/control-room/src/components/PersonaColumn.tsx apps/control-room/src/components/icons.tsx apps/control-room/src/components/scan && git status --short && git commit -F - <<'EOF'
feat(control-room): scan data hooks and side panels in the dusk design system

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

Expected: `git status --short` lists only the staged files above, and the commit succeeds.

---

### Task 7: Control room — node canvas, scan page, routing

**Files:**
- Modify: `apps/control-room/package.json` and `pnpm-lock.yaml` (via `pnpm add`)
- Create: `apps/control-room/src/lib/scanLayout.ts`
- Create: `apps/control-room/src/components/scan/nodes.tsx`
- Create: `apps/control-room/src/components/scan/ScanGraph.tsx`
- Create: `apps/control-room/src/components/scan/ScanBar.tsx`
- Create: `apps/control-room/src/components/scan/ScanPage.tsx`
- Modify: `apps/control-room/src/index.css` (append the unlayered `.scan-flow` section)
- Modify: `apps/control-room/src/App.tsx` (full replacement, interim form)

**Interfaces:**
- **Consumes (Task 6):**
  - hooks: `useScan`, `useScanReport`
  - `SidePanel`
  - from `lib/scan.ts`: `SCAN_STATUS`, `SCAN_STATE_LABELS`, `VERDICT`, `VERDICT_ORDER`, `personaShortName`, `hostOf`, `runProgress`, `totalFindings`, `worstSeverity`, `verdictCounts`, `resolveScanNode`
  - `StateBadge({ idleLabel })`, the `Cross` and `Minus` icons, and `Query.scan` / `Query.node`
- **Consumes (redesign):**
  - `Nav({ onHome, compact?, frosted?, children?, action })`
  - `Chip`, `Dot`, `SEVERITY_STYLES`
  - icons: `Check`, `Plus`, `ArrowUpRight`, `PERSONA_GLYPHS`
  - `formatElapsed`, `shortUrl`, `MAX_STEPS`
- **Consumes (`@xyflow/react` 12.11.6, checked against its published types):**
  - components: `ReactFlow`, `ReactFlowProvider`, `Background`, `BackgroundVariant`, `Panel`, `Handle`, `Position`
  - hook: `useReactFlow()`, which gives `fitView(opts) → Promise<boolean>`, `zoomIn` / `zoomOut({ duration })`, `setCenter(x, y, { zoom, duration })`, `getZoom()` and `screenToFlowPosition({ x, y })`
  - types: `Node<Data extends Record<string, unknown>, Type>`, `NodeProps<N>`, `NodeTypes`, `Edge`, `FitViewOptions`
  - `ReactFlow` props: `deleteKeyCode`, `selectionKeyCode` and `panActivationKeyCode` all accept `null`, and `colorMode` accepts `"dark"`
- **Produces:**
  - **Layout** (`lib/scanLayout.ts`):
    - `layoutScan(tree: ScanTreeResponse, options: LayoutOptions): { nodes: ScanFlowNode[]; edges: Edge[] }`
    - `LayoutOptions = { selected: string; issues: number | null; onSelect: (nodeId: string) => void }`
    - types `RootNodeData`, `TaskNodeData`, `PersonaNodeData`, `RootFlowNode`, `TaskFlowNode`, `PersonaFlowNode`, `ScanFlowNode`
  - **Nodes** (`nodes.tsx`): `RootNode(props: NodeProps<RootFlowNode>)`, `TaskNode(props: NodeProps<TaskFlowNode>)`, `PersonaNode(props: NodeProps<PersonaFlowNode>)`
  - **Components:**
    - `ScanGraph({ nodes: ScanFlowNode[]; edges: Edge[] })`
    - `ScanBar({ tree: ScanTreeResponse })`
    - `ScanPage({ scanId: string; nodeId: string | null; onSelectNode: (nodeId: string) => void; onOpenRun: (runId: string) => void })`. `onSelectNode` must be stable, because it is baked into each node's data.
  - **Routing:** `App` routes `?scan=`.

- [ ] **Step 1: Add React Flow and confirm what the overrides rely on**

Run:

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && pnpm --filter @friction/control-room add @xyflow/react@^12.11.6
```

Expected:
- `apps/control-room/package.json` dependencies gain `"@xyflow/react": "^12.11.6"`.
- The install ends without `ERR_PNPM_IGNORED_BUILDS`. `@xyflow/react` has no install scripts.

Then run:

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && grep -oE "\.react-flow__(edge\.animated path|edge-path|handle|attribution a)" apps/control-room/node_modules/@xyflow/react/dist/style.css | sort -u && grep -c "xy-background-color\|xy-edge-stroke\|xy-attribution-background-color" apps/control-room/node_modules/@xyflow/react/dist/style.css
```

Expected:
- the four selectors: `.react-flow__attribution a`, `.react-flow__edge-path`, `.react-flow__edge.animated path` and `.react-flow__handle`
- a count greater than 0

These are the names Step 5 overrides. If any is missing, adjust the Step 5 selectors to the names that `style.css` actually uses.

- [ ] **Step 2: Create `apps/control-room/src/lib/scanLayout.ts`**

```ts
/**
 * Scan tree -> React Flow nodes and edges. Pure. The shape is fixed (root ->
 * tasks -> three personas each), so positions are computed directly, left to
 * right, with no layout library:
 *
 *   root (x 0)  ->  tasks (x 320)  ->  personas (x 660)
 *
 * Each task owns a block of three persona rows; the task sits in the middle
 * of its block and the root in the middle of everything.
 */
import type { Edge, Node } from "@xyflow/react";
import {
  scanNodeId,
  type PersonaId,
  type PersonaState,
  type ScanStatus,
  type ScanTreeResponse,
  type Severity,
  type TaskSource,
  type TaskVerdict,
} from "@friction/shared";
import { hostOf, runProgress, verdictCounts, worstSeverity } from "./scan";

const COLUMN_X = { root: 0, task: 320, persona: 660 } as const;
/** Rendered heights (nodes.tsx: task h-28, persona h-11). The root grows with its content; its height is an estimate used only for centring. */
const ROOT_HEIGHT = 160;
const TASK_HEIGHT = 112;
const PERSONA_HEIGHT = 44;
const PERSONA_PITCH = PERSONA_HEIGHT + 8;
/** Three persona rows. */
const BLOCK = PERSONA_PITCH * 2 + PERSONA_HEIGHT;
const BLOCK_GAP = 32;

type Selectable = { selected: boolean; onSelect: (nodeId: string) => void };

export type RootNodeData = Selectable & {
  host: string;
  status: ScanStatus;
  message: string | null;
  pagesRead: number;
  taskSource: TaskSource | null;
  tasks: number;
  verdicts: Record<TaskVerdict, number>;
  runsDone: number;
  runsTotal: number;
  /** Merged issue count from the report, once it has arrived. */
  issues: number | null;
};

export type TaskNodeData = Selectable & {
  index: number;
  title: string;
  /** PERSONAS order. */
  personas: Array<{ personaId: PersonaId; state: PersonaState }>;
  findingCount: number;
  worst: Severity | null;
};

export type PersonaNodeData = Selectable & {
  personaId: PersonaId;
  state: PersonaState;
  stepCount: number;
  findingCount: number;
  worst: Severity | null;
};

export type RootFlowNode = Node<RootNodeData, "root">;
export type TaskFlowNode = Node<TaskNodeData, "task">;
export type PersonaFlowNode = Node<PersonaNodeData, "persona">;
export type ScanFlowNode = RootFlowNode | TaskFlowNode | PersonaFlowNode;

export interface LayoutOptions {
  /** Id of the selected node (see scanNodeId). */
  selected: string;
  issues: number | null;
  onSelect: (nodeId: string) => void;
}

export function layoutScan(tree: ScanTreeResponse, options: LayoutOptions): { nodes: ScanFlowNode[]; edges: Edge[] } {
  const { selected, onSelect } = options;
  const count = tree.tasks.length;
  const contentHeight = count > 0 ? count * (BLOCK + BLOCK_GAP) - BLOCK_GAP : ROOT_HEIGHT;
  const progress = runProgress(tree);

  const nodes: ScanFlowNode[] = [
    {
      id: "root",
      type: "root",
      position: { x: COLUMN_X.root, y: (contentHeight - ROOT_HEIGHT) / 2 },
      data: {
        host: hostOf(tree.scan.url),
        status: tree.scan.status,
        message: tree.scan.message,
        pagesRead: tree.scan.pages.length,
        taskSource: tree.scan.taskSource,
        tasks: count,
        verdicts: verdictCounts(tree),
        runsDone: progress.done,
        runsTotal: progress.total,
        issues: options.issues,
        selected: selected === "root",
        onSelect,
      },
    },
  ];
  const edges: Edge[] = [];

  tree.tasks.forEach((task, position) => {
    const top = position * (BLOCK + BLOCK_GAP);
    const taskId = scanNodeId({ kind: "task", index: task.index });
    nodes.push({
      id: taskId,
      type: "task",
      position: { x: COLUMN_X.task, y: top + (BLOCK - TASK_HEIGHT) / 2 },
      data: {
        index: task.index,
        title: task.title,
        personas: task.personas.map((p) => ({ personaId: p.personaId, state: p.state })),
        findingCount: task.personas.reduce((sum, p) => sum + p.findingCount, 0),
        worst: worstSeverity(task.personas),
        selected: selected === taskId,
        onSelect,
      },
    });
    edges.push({ id: `root>${taskId}`, source: "root", target: taskId, type: "smoothstep" });

    task.personas.forEach((persona, row) => {
      const personaNodeId = scanNodeId({ kind: "persona", index: task.index, personaId: persona.personaId });
      nodes.push({
        id: personaNodeId,
        type: "persona",
        position: { x: COLUMN_X.persona, y: top + row * PERSONA_PITCH },
        data: {
          personaId: persona.personaId,
          state: persona.state,
          stepCount: persona.stepCount,
          findingCount: persona.findingCount,
          worst: persona.worstSeverity,
          selected: selected === personaNodeId,
          onSelect,
        },
      });
      edges.push({
        id: `${taskId}>${personaNodeId}`,
        source: taskId,
        target: personaNodeId,
        type: "smoothstep",
        animated: persona.state === "running",
      });
    });
  });

  return { nodes, edges };
}
```

- [ ] **Step 3: Create `apps/control-room/src/components/scan/nodes.tsx`**

```tsx
/**
 * The three node kinds on the scan canvas. Each node is one <button>, so Tab
 * reaches it and Enter selects it; React Flow's own selection, dragging and
 * connecting are off (see ScanGraph).
 *
 * React Flow sets pointer-events: none on nodes that are neither draggable
 * nor selectable, and the property inherits, so every button opts back in
 * with pointer-events-auto.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { PERSONA_BY_ID, type PersonaState } from "@friction/shared";
import { MAX_STEPS } from "../../lib/config";
import { SCAN_STATE_LABELS, SCAN_STATUS, VERDICT, VERDICT_ORDER, personaShortName } from "../../lib/scan";
import type { PersonaFlowNode, RootFlowNode, TaskFlowNode } from "../../lib/scanLayout";
import { Chip, Dot, SEVERITY_STYLES, StateBadge } from "../badges";
import { Check, Cross, PERSONA_GLYPHS } from "../icons";

/** Shared by every node: opaque graphite, text lifts to white on hover, a white ring set 4px off the edge when selected. */
function frame(selected: boolean): string {
  return `group pointer-events-auto bg-graphite text-left transition-colors duration-150 ease-out ${
    selected ? "ring-1 ring-white ring-offset-4 ring-offset-void" : ""
  }`;
}

/** Neutral nodes: a 15% hairline that lifts on hover and goes full strength when selected. */
function neutralBorder(selected: boolean): string {
  return selected ? "border-hairline" : "border-hairline/15 hover:border-hairline/40";
}

export function RootNode({ id, data }: NodeProps<RootFlowNode>) {
  const status = SCAN_STATUS[data.status];
  return (
    <>
      <button
        type="button"
        onClick={() => data.onSelect(id)}
        aria-current={data.selected ? "true" : undefined}
        className={`${frame(data.selected)} ${neutralBorder(data.selected)} flex w-65 flex-col rounded-card border p-4`}
      >
        <span className="flex items-center justify-between gap-2">
          <Chip tone={status.tone}>{status.label}</Chip>
          <span className="text-caption text-smoke">Site</span>
        </span>
        <span className="mt-3 truncate font-heading text-subheading text-bone group-hover:text-white">{data.host}</span>

        {data.status === "crawling" && (
          <>
            <span className="mt-1 line-clamp-2 text-caption text-ash">{data.message ?? "Opening the site"}</span>
            <span className="mt-1 text-caption tabular-nums text-smoke">
              {data.pagesRead} {data.pagesRead === 1 ? "page" : "pages"} read
            </span>
          </>
        )}

        {data.tasks > 0 && (
          <>
            <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption tabular-nums text-ash">
              {VERDICT_ORDER.filter((verdict) => verdict !== "pending" || data.verdicts.pending > 0).map((verdict) => (
                <span key={verdict} className="inline-flex items-center gap-1.5">
                  <Dot tone={VERDICT[verdict].tone} size={6} />
                  <span className="text-bone">{data.verdicts[verdict]}</span> {VERDICT[verdict].label.toLowerCase()}
                </span>
              ))}
            </span>
            <span className="mt-1 text-caption tabular-nums text-smoke">
              {data.issues === null ? "Counting issues" : `${data.issues} ${data.issues === 1 ? "issue" : "issues"}`} · {data.runsDone}/{data.runsTotal}{" "}
              runs done
            </span>
          </>
        )}

        {data.status === "failed" && <span className="mt-2 line-clamp-3 text-caption text-sev-5">{data.message ?? "The scan failed."}</span>}
        {data.taskSource === "fallback" && <span className="mt-2 text-caption text-sev-4">Couldn't read the site; these tasks are generic.</span>}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

/** ✓ / ✗ / … for one persona on a task node, in the system's lights. */
function Mark({ state }: { state: PersonaState }) {
  switch (state) {
    case "succeeded":
      return <Check size={14} className="text-white" />;
    case "failed":
      return <Cross size={14} className="text-sev-5" />;
    case "timeout":
      return <Cross size={14} className="text-sev-4" />;
    case "running":
      return <Dot tone="glow" size={8} />;
    default:
      return <Dot tone="idle" size={6} />;
  }
}

export function TaskNode({ id, data }: NodeProps<TaskFlowNode>) {
  const border = data.worst !== null ? SEVERITY_STYLES[data.worst].box : neutralBorder(data.selected);
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        onClick={() => data.onSelect(id)}
        aria-current={data.selected ? "true" : undefined}
        title={data.title}
        className={`${frame(data.selected)} ${border} flex h-28 w-70 flex-col rounded-2xl border p-3`}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-caption tabular-nums tracking-normal text-ash">T{data.index + 1}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {data.personas.map((p) => {
              const label = `${personaShortName(p.personaId)}: ${SCAN_STATE_LABELS[p.state]}`;
              return (
                <span key={p.personaId} className="flex h-4 w-4 items-center justify-center" title={label}>
                  <Mark state={p.state} />
                  <span className="sr-only">{label}</span>
                </span>
              );
            })}
          </span>
        </span>
        <span className="mt-1.5 line-clamp-2 text-ui leading-snug text-bone group-hover:text-white">{data.title}</span>
        <span className="mt-auto text-caption tabular-nums text-smoke">
          <span className={data.findingCount > 0 ? "text-bone" : undefined}>{data.findingCount}</span>{" "}
          {data.findingCount === 1 ? "finding" : "findings"}
        </span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

export function PersonaNode({ id, data }: NodeProps<PersonaFlowNode>) {
  const Glyph = PERSONA_GLYPHS[data.personaId];
  const findings = `${data.findingCount} ${data.findingCount === 1 ? "finding" : "findings"}`;
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        onClick={() => data.onSelect(id)}
        aria-current={data.selected ? "true" : undefined}
        title={PERSONA_BY_ID[data.personaId].displayName}
        className={`${frame(data.selected)} ${neutralBorder(data.selected)} flex h-11 w-84 items-center gap-2 rounded-full border pl-2.5 pr-2`}
      >
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-icon bg-white text-black">
          <Glyph size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-ui text-bone group-hover:text-white">{personaShortName(data.personaId)}</span>
        <span className="shrink-0 font-mono text-caption tabular-nums tracking-normal text-smoke" title={`${data.stepCount} of ${MAX_STEPS} steps`}>
          {data.stepCount}/{MAX_STEPS}
        </span>
        <span
          className="flex shrink-0 items-center gap-1.5 text-caption tabular-nums text-bone"
          title={data.worst !== null ? `${findings}, worst S${data.worst}` : findings}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${data.worst !== null ? SEVERITY_STYLES[data.worst].dot : "bg-slate"}`} />
          {data.findingCount}
          <span className="sr-only">{data.findingCount === 1 ? "finding" : "findings"}</span>
        </span>
        <StateBadge state={data.state} idleLabel="Queued" />
      </button>
    </>
  );
}
```

- [ ] **Step 4: Create `apps/control-room/src/components/scan/ScanGraph.tsx`**

```tsx
/**
 * The scan tree on a pan-and-zoom canvas. Positions come from layoutScan, so
 * nodes are never dragged; the selection lives in the URL, so React Flow's own
 * selection, connecting and delete keys are all off. Each node is a <button>
 * (see nodes.tsx): Tab reaches it and Enter selects it.
 */
import { useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ScanFlowNode } from "../../lib/scanLayout";
import { Minus, Plus } from "../icons";
import { PersonaNode, RootNode, TaskNode } from "./nodes";

const NODE_TYPES: NodeTypes = { root: RootNode, task: TaskNode, persona: PersonaNode };
/** maxZoom 1 keeps a lone site node (while crawling) at its real size. */
const FIT: FitViewOptions = { padding: 0.12, maxZoom: 1 };

/** An animation's length, or 0 when the viewer asked for reduced motion. */
function motion(ms: number): number {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}

interface Props {
  nodes: ScanFlowNode[];
  edges: Edge[];
}

export function ScanGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ nodes, edges }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const { getZoom, screenToFlowPosition, setCenter } = useReactFlow();

  // Tabbing to a node outside the view makes the browser scroll React Flow's
  // overflow-hidden root, which React Flow never notices, so nodes and edges
  // drift apart. Undo any such scroll; reveal() pans the viewport instead.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const reset = (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.scrollTop !== 0 || target.scrollLeft !== 0)) {
        target.scrollTop = 0;
        target.scrollLeft = 0;
      }
    };
    element.addEventListener("scroll", reset, true);
    return () => element.removeEventListener("scroll", reset, true);
  }, []);

  /** Keyboard focus on a node outside the view pans that node into the middle. */
  const reveal = (event: React.FocusEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(":focus-visible")) return;
    const node = target.closest(".react-flow__node");
    if (!node) return;
    const box = node.getBoundingClientRect();
    const view = event.currentTarget.getBoundingClientRect();
    if (box.left >= view.left && box.right <= view.right && box.top >= view.top && box.bottom <= view.bottom) return;
    const centre = screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    void setCenter(centre.x, centre.y, { zoom: Math.max(getZoom(), 0.6), duration: motion(200) });
  };

  return (
    <div ref={frame} onFocus={reveal} className="scan-flow absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode="dark"
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        panActivationKeyCode={null}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={FIT}
        minZoom={0.15}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgb(229 229 229 / 0.12)" />
        <FitOnGrow count={nodes.length} />
        <CanvasControls />
      </ReactFlow>
    </div>
  );
}

/** The fitView prop fits once, on load; fit again when the task nodes first appear after the crawl. */
function FitOnGrow({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  const previous = useRef(count);
  useEffect(() => {
    const grew = count > previous.current;
    previous.current = count;
    if (!grew) return;
    // Give React Flow a beat to measure the new nodes before fitting them.
    const timer = window.setTimeout(() => void fitView({ ...FIT, duration: motion(300) }), 80);
    return () => window.clearTimeout(timer);
  }, [count, fitView]);
  return null;
}

/** Zoom and fit as ghost pills on a graphite pill, in place of React Flow's square controls. */
function CanvasControls() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  return (
    <Panel position="bottom-left" className="flex items-center gap-0.5 rounded-full border border-hairline/15 bg-graphite/90 p-1 backdrop-blur-xs">
      <button type="button" onClick={() => void zoomIn({ duration: motion(160) })} className="pill-ghost h-8 w-8 border-transparent px-0" aria-label="Zoom in" title="Zoom in">
        <Plus size={14} />
      </button>
      <button type="button" onClick={() => void zoomOut({ duration: motion(160) })} className="pill-ghost h-8 w-8 border-transparent px-0" aria-label="Zoom out" title="Zoom out">
        <Minus size={14} />
      </button>
      <button type="button" onClick={() => void fitView({ ...FIT, duration: motion(300) })} className="pill-ghost h-8 border-transparent px-3 text-caption">
        Fit
      </button>
    </Panel>
  );
}
```

- [ ] **Step 5: Append the canvas overrides to `apps/control-room/src/index.css`**

Add this at the very end of the file, after the last `.scrubber::-moz-range-thumb { … }` block. It must stay **outside** any `@layer`.

```css

/* ----------------------------------------------------------- scan canvas */

/*
 * React Flow's stylesheet is unlayered, and an unlayered rule beats any rule
 * inside a cascade layer (Tailwind's utilities included). So these overrides
 * are unlayered too, and scoped one class deeper than React Flow's own.
 */
.scan-flow .react-flow {
  --xy-background-color: transparent;
  --xy-edge-stroke: rgb(229 229 229 / 0.18);
  --xy-edge-stroke-width: 1;
  --xy-attribution-background-color: transparent;
}

/* An edge into a running persona: a moving dash in white, never violet paint. */
.scan-flow .react-flow__edge.animated .react-flow__edge-path {
  stroke: rgb(255 255 255 / 0.7);
  stroke-width: 1.5;
}

/* Edges need handles to attach to; nobody needs to see them. */
.scan-flow .react-flow__handle {
  opacity: 0;
}

.scan-flow .react-flow__attribution a {
  color: var(--color-smoke);
}

@media (prefers-reduced-motion: reduce) {
  .scan-flow .react-flow__edge.animated path {
    animation: none;
  }
}
```

- [ ] **Step 6: Create `apps/control-room/src/components/scan/ScanBar.tsx`**

```tsx
import { useEffect, useState } from "react";
import { isScanFinished, type ScanTreeResponse } from "@friction/shared";
import { formatElapsed, shortUrl } from "../../lib/format";
import { SCAN_STATUS, hostOf, runProgress } from "../../lib/scan";
import { Chip, Dot } from "../badges";
import { ArrowUpRight } from "../icons";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** The scan's identity and clock, under the floating nav: the same anatomy as RunBar. */
export function ScanBar({ tree }: { tree: ScanTreeResponse }) {
  const { scan } = tree;
  const finished = isScanFinished(scan.status);
  const now = useNow(!finished);
  const status = SCAN_STATUS[scan.status];
  const progress = runProgress(tree);
  const elapsed = (finished ? (scan.completedAt ?? now) : now) - scan.createdAt;
  const line =
    progress.total > 0
      ? `${progress.done}/${progress.total} runs done`
      : scan.status === "failed"
        ? "No runs were started"
        : `${scan.pages.length} ${scan.pages.length === 1 ? "page" : "pages"} read`;

  return (
    <div className="shrink-0 px-4 pt-20 sm:px-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-85">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="shrink-0">
              <Chip tone={status.tone}>{status.label}</Chip>
            </span>
            {scan.taskSource === "mock" && (
              <span className="shrink-0" title="No API keys: canned tasks, and every run replays the golden run">
                <Chip tone="warn">Mock scan</Chip>
              </span>
            )}
            {scan.taskSource === "fallback" && (
              <span className="shrink-0" title="The site could not be read, so the tasks are generic">
                <Chip tone="warn">Generic tasks</Chip>
              </span>
            )}
            <a
              href={scan.url}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex min-w-0 items-center gap-1 font-mono text-caption tracking-normal text-smoke transition-colors hover:text-white"
              title={scan.url}
            >
              <span className="truncate">{shortUrl(scan.url)}</span>
              <ArrowUpRight size={13} className="shrink-0 opacity-60 group-hover:opacity-100" />
            </a>
          </div>
          <h1 className="mt-1.5 truncate font-heading text-heading-sm font-medium tracking-[-0.02em] text-bone">Site scan of {hostOf(scan.url)}</h1>
        </div>

        <div className="shrink-0 text-right max-sm:text-left">
          <div className="font-mono text-[32px] leading-none tabular-nums tracking-[-0.02em] text-white" title="Elapsed">
            {formatElapsed(elapsed)}
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-2 text-caption tabular-nums text-ash max-sm:justify-start">
            <Dot tone={status.tone} size={7} />
            {line}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create `apps/control-room/src/components/scan/ScanPage.tsx`**

```tsx
import { useMemo } from "react";
import { parseScanNode, scanNodeId } from "@friction/shared";
import { useScan } from "../../hooks/useScan";
import { useScanReport } from "../../hooks/useScanReport";
import { resolveScanNode, runProgress, totalFindings } from "../../lib/scan";
import { layoutScan } from "../../lib/scanLayout";
import { Dot } from "../badges";
import { ScanBar } from "./ScanBar";
import { ScanGraph } from "./ScanGraph";
import { SidePanel } from "./SidePanel";

interface Props {
  scanId: string;
  nodeId: string | null;
  /** Must be stable (useCallback): it is baked into every node's data. */
  onSelectNode: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

export function ScanPage({ scanId, nodeId, onSelectNode, onOpenRun }: Props) {
  const { tree, stale, missing } = useScan(scanId);
  // Refetch the report when findings arrive, a run finishes, the tasks appear, or the status changes.
  const refreshKey = tree ? `${totalFindings(tree)}:${runProgress(tree).done}:${tree.tasks.length}:${tree.scan.status}` : "none";
  const { report } = useScanReport(scanId, refreshKey);
  const node = tree ? resolveScanNode(parseScanNode(nodeId), tree) : parseScanNode(nodeId);
  const selected = scanNodeId(node);
  const issueCount = report ? report.issues.length : null;

  const graph = useMemo(
    () => (tree ? layoutScan(tree, { selected, issues: issueCount, onSelect: onSelectNode }) : null),
    [tree, selected, issueCount, onSelectNode],
  );

  if (missing) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pt-20 text-center">
        <p className="text-body text-bone">This scan was not found.</p>
        <p className="font-mono text-caption tracking-normal text-smoke">{scanId}</p>
      </main>
    );
  }

  if (!tree || !graph) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pt-20 text-body text-smoke" aria-busy={!stale}>
        {stale ? (
          <span className="flex items-center gap-2">
            <Dot tone="warn" size={7} pulse />
            The Worker is not answering. Retrying every 2 seconds…
          </span>
        ) : (
          <>
            <div className="wash wash-sweep h-px w-56" aria-hidden="true" />
            Loading the scan…
          </>
        )}
      </main>
    );
  }

  return (
    <>
      <ScanBar tree={tree} />

      {stale && (
        <div className="flex shrink-0 justify-center px-4 pt-4">
          <p role="status" className="glass inline-flex max-w-3xl items-center gap-2.5 rounded-nav border border-hairline/20 px-4 py-2 text-ui text-bone">
            <Dot tone="warn" size={7} pulse />
            <span>
              <span className="text-white">Reconnecting.</span> Lost contact with the Worker; showing the last update and retrying every 2 seconds.
            </span>
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-5 sm:px-6 sm:pb-6 lg:flex-row lg:overflow-hidden">
        <section
          aria-label="Scan tree"
          className="relative h-105 shrink-0 overflow-hidden rounded-card border border-hairline/10 lg:h-auto lg:min-w-0 lg:flex-1"
        >
          <ScanGraph nodes={graph.nodes} edges={graph.edges} />
        </section>
        <aside aria-label="Details" className="pane shrink-0 lg:w-115 lg:overflow-y-auto lg:pr-1">
          <SidePanel tree={tree} report={report} node={node} onSelect={onSelectNode} onOpenRun={onOpenRun} />
        </aside>
      </div>
    </>
  );
}
```

- [ ] **Step 8: Replace `apps/control-room/src/App.tsx` (interim form: the scan route is added, and the landing is still Task 8's job)**

```tsx
import { useCallback, useMemo, useState } from "react";
import { GOLDEN_RUN_ID, PERSONA_IDS, type PersonaId, type StepPayload } from "@friction/shared";
import { Landing } from "./components/Landing";
import { Nav } from "./components/Nav";
import { PersonaColumn } from "./components/PersonaColumn";
import { ReportView } from "./components/ReportView";
import { RunBar } from "./components/RunBar";
import type { StartedRun } from "./components/RunForm";
import { Play, Plus, Sparkle } from "./components/icons";
import { ScanPage } from "./components/scan/ScanPage";
import { useReport } from "./hooks/useReport";
import { useRunStream } from "./hooks/useRunStream";
import { snapshotFromView, summarize } from "./lib/runState";
import { useQuery, type Tab } from "./lib/useQuery";

export default function App() {
  const [query, setQuery] = useQuery();
  const [startNotice, setStartNotice] = useState<string | null>(null);
  const [overHero, setOverHero] = useState(true);

  // The single-run view only: a scan page streams its selected persona node itself.
  const runId = query.scan ? null : query.run;
  const stream = useRunStream(runId, { replay: query.replay });
  const { view } = stream;
  const summary = summarize(view);

  // Whatever is on screen, as a snapshot: lets the report be built with no Worker.
  const localSnapshot = useMemo(() => stream.snapshot ?? snapshotFromView(view), [stream.snapshot, view]);
  const report = useReport(runId, query.tab === "report", localSnapshot, {
    localOnly: stream.origin === "bundled",
    refreshKey: summary.frictionCount + (summary.phase === "complete" ? 1000 : 0),
  });

  const findStep = useCallback(
    (personaId: PersonaId, seq: number): StepPayload | undefined => {
      const live = view.personas[personaId].steps.find((step) => step.seq === seq);
      if (live) return live.payload;
      const recorded = stream.snapshot?.events.find((e) => e.type === "step" && e.personaId === personaId && e.seq === seq);
      return recorded?.type === "step" ? recorded.payload : undefined;
    },
    [view, stream.snapshot],
  );

  const onStarted = useCallback(
    (run: StartedRun) => {
      setStartNotice(run.notice);
      setQuery({ run: run.runId, scan: null, node: null, replay: run.replay, tab: "room" });
    },
    [setQuery],
  );

  const open = useCallback(
    (id: string, replay: boolean) => {
      setStartNotice(null);
      setQuery({ run: id, scan: null, node: null, replay, tab: "room" });
    },
    [setQuery],
  );

  const openRun = useCallback((id: string) => open(id, false), [open]);
  const selectNode = useCallback((node: string) => setQuery({ node }), [setQuery]);

  const goHome = useCallback(() => {
    setStartNotice(null);
    setQuery({ run: null, scan: null, node: null, replay: false, tab: "room" });
  }, [setQuery]);

  const notice = startNotice ?? stream.notice;

  if (query.scan) {
    return (
      <div className="flex h-full flex-col">
        <Nav
          onHome={goHome}
          compact
          action={
            <button type="button" onClick={goHome} className="pill-cta h-8.5 px-3.5 text-ui sm:px-4" aria-label="New scan">
              <Plus size={14} />
              <span className="hidden sm:inline">New scan</span>
            </button>
          }
        />
        <ScanPage key={query.scan} scanId={query.scan} nodeId={query.node} onSelectNode={selectNode} onOpenRun={openRun} />
      </div>
    );
  }

  if (!query.run) {
    return (
      <div className="flex h-full flex-col">
        <Nav
          onHome={goHome}
          frosted={overHero}
          action={
            <button type="button" onClick={() => open(GOLDEN_RUN_ID, true)} className="pill-cta h-8.5 px-4 text-ui">
              <Play size={12} />
              Watch the demo
            </button>
          }
        >
          <a href="#how" className="pill-ghost hidden border-transparent md:inline-flex">
            How it works
          </a>
          <a href="#runs" className="pill-ghost hidden border-transparent md:inline-flex">
            Recent runs
          </a>
        </Nav>
        <Landing onOpen={open} onStarted={onStarted} onOverHero={setOverHero} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Nav
        onHome={goHome}
        compact
        action={
          <button type="button" onClick={goHome} className="pill-cta h-8.5 px-3.5 text-ui sm:px-4" aria-label="New run">
            <Plus size={14} />
            <span className="hidden sm:inline">New run</span>
          </button>
        }
      >
        <TabButton tab="room" current={query.tab} onTab={(tab) => setQuery({ tab })}>
          <span className="sm:hidden">Room</span>
          <span className="hidden sm:inline">Control room</span>
        </TabButton>
        <TabButton tab="report" current={query.tab} onTab={(tab) => setQuery({ tab })}>
          Report
          {summary.frictionCount > 0 && (
            <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/12 px-1.5 text-[12px] tabular-nums text-white">
              {summary.frictionCount}
            </span>
          )}
        </TabButton>
      </Nav>

      <RunBar
        view={view}
        origin={stream.origin}
        connection={stream.connection}
        elapsedMs={stream.elapsedMs}
        replay={stream.replay}
        isReplay={query.replay}
        onToggleReplay={() => {
          setStartNotice(null);
          setQuery({ replay: !query.replay });
        }}
      />

      {notice && (
        <div className="flex shrink-0 justify-center px-4 pt-4">
          <p role="status" className="glass inline-flex max-w-3xl items-start gap-2.5 rounded-nav border border-hairline/20 px-4 py-2 text-ui text-bone">
            <Sparkle size={14} className="mt-0.75 shrink-0 text-white" />
            <span>
              <span className="text-white">Heads up.</span> {notice}
            </span>
          </p>
        </div>
      )}

      {query.tab === "report" ? (
        <ReportView report={report.report} loading={report.loading} local={report.local} findStep={findStep} />
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 pb-4 pt-5 sm:px-6 sm:pb-6 lg:grid-cols-3 lg:overflow-hidden">
          {PERSONA_IDS.map((id) => (
            <PersonaColumn key={id} persona={view.personas[id]} allowLiveView={stream.origin === "live"} startTs={view.firstTs} />
          ))}
        </main>
      )}
    </div>
  );
}

function TabButton({ tab, current, onTab, children }: { tab: Tab; current: Tab; onTab: (tab: Tab) => void; children: React.ReactNode }) {
  const active = tab === current;
  return (
    <button
      type="button"
      onClick={() => onTab(tab)}
      aria-current={active ? "page" : undefined}
      className={`pill-ghost ${active ? "" : "border-transparent text-white/70"}`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 9: Typecheck and build**

Run: `pnpm --filter @friction/control-room typecheck`
Expected: exit 0.

Run: `pnpm --filter @friction/control-room build`
Expected: `vite build` succeeds, and `dist/assets/` holds one CSS file and one JS file plus the bundled `.woff2` fonts.

Run in Git Bash:

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && grep -l "url(http" apps/control-room/dist/assets/*.css || echo "no remote CSS urls"
```

Expected: `no remote CSS urls`. React Flow's CSS is bundled, not fetched.

- [ ] **Step 10: Check the verification ports are free**

Run with the PowerShell tool:

```powershell
$busy = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 8797, 8798, 5183, 9239 })
if ($busy.Count -eq 0) { "ports free" } else { $busy | Select-Object LocalPort, OwningProcess | Format-Table }
```

Expected: `ports free`. If any port is taken, stop and report it. Do **not** kill a process you did not start.

- [ ] **Step 11: Start the three apps on the verification ports**

Start each command with the Bash tool in the background (`run_in_background: true`), and note each returned task id: WORKER, ORCH and UI.

1. Worker:
   ```bash
   cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && pnpm --filter @friction/worker exec wrangler dev --port 8797 --inspector-port 9239
   ```
2. Orchestrator, in mock mode.
   - Use `start`, not `dev`: `node --watch` restarts spuriously under this OneDrive path.
   - `MOCK_SPEED=1` slows mock playback 3x, so crawling → queued → running can be watched. A mock scan then takes about 2 minutes.
   ```bash
   cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && PORT=8798 WORKER_URL=http://127.0.0.1:8797 FRICTION_MOCK=1 MOCK_SPEED=1 pnpm --filter @friction/orchestrator start
   ```
3. Control room. `lib/config.ts` reads `import.meta.env.VITE_WORKER_URL` and `VITE_ORCHESTRATOR_URL`. Vite exposes `VITE_*` process env vars, and they take precedence over any `.env*` file, so no config change is needed.
   ```bash
   cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && VITE_WORKER_URL=http://127.0.0.1:8797 VITE_ORCHESTRATOR_URL=http://127.0.0.1:8798 pnpm --filter @friction/control-room exec vite --port 5183 --strictPort
   ```

Wait for all three to answer (PowerShell tool):

```powershell
$checks = [ordered]@{ "worker" = "http://127.0.0.1:8797/api/health"; "orchestrator" = "http://127.0.0.1:8798/health"; "control room" = "http://localhost:5183/" }
foreach ($name in $checks.Keys) {
  $ok = $false
  for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $checks[$name] | Out-Null; $ok = $true } catch { Start-Sleep -Seconds 1 }
  }
  "$name ready: $ok"
}
(Invoke-RestMethod http://127.0.0.1:8798/health).mode
```

Expected: `worker ready: True`, `orchestrator ready: True`, `control room ready: True`, then `mock`.

- [ ] **Step 12: Run the mock scan end to end**

Run with the Bash tool (timeout 300000 ms):

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && ORCHESTRATOR_URL=http://127.0.0.1:8798 WORKER_URL=http://127.0.0.1:8797 pnpm --filter @friction/orchestrator smoke:scan
```

Expected:
- progress lines, then `report: <n> issues, widest hit <w>/30 runs, verdicts {...}`
- a last line of `OK  open http://localhost:5173/?scan=s_…`

Note the scan id. Open it on **5183**, not 5173: `http://localhost:5183/?scan=<id>`.

- [ ] **Step 13: Check the scan page in a browser, at desktop width**

Use the Chrome DevTools MCP tools (`new_page`, `navigate_page`, `take_snapshot`, `take_screenshot`, `click`, `press_key`, `evaluate_script`, `emulate`, `list_console_messages`).
1. **Open the page.** `new_page` `http://localhost:5183/?scan=<id>`, then `resize_page` to 1440 × 900 and take a screenshot.
   - The canvas is on the left and the side panel on the right, at about 460px.
   - Nodes run in columns, left to right: site, then tasks, then personas.
   - Task nodes with findings have a coloured border.
2. **Count the elements.** `evaluate_script`: `() => [document.querySelectorAll('.react-flow__node').length, document.querySelectorAll('.react-flow__edge').length]`. Expected `[41, 40]`.
3. **Root panel.** Take a snapshot and confirm the panel shows:
   - "Site report" and the host
   - the "Mock scan: …" notice
   - four verdict tiles
   - three persona rows reading "N of 10"
   - five severity columns
   - an issue list whose first card reads "Hit in N/30 runs · K tasks · …" with N > 1
   - occurrence pills "T1 · Impatient" etc.
4. **Task node.** Click the node labelled `T3`.
   - `evaluate_script` `() => location.search` contains `node=t2`.
   - T3 has the white offset ring.
   - The panel shows the title, "Why it's critical", "Success looks like", three persona rows with state badges, "Open full control room", and "Issues in this task".
5. **Persona row.** Click the "Keyboard-only user" row in the task panel.
   - `location.search` contains `node=t2.keyboard`.
   - The panel shows "Back to T3", then the `PersonaColumn` with its steps timeline, then "Evidence" cards.
   - `evaluate_script` `() => [...document.querySelectorAll('aside img')].filter(i => i.complete && i.naturalWidth > 0).length` returns a number greater than 0.
6. **Occurrence chip.** Navigate to `?scan=<id>` (the root), then click the first occurrence pill of issue 01. `location.search` now has the matching `node=t<i>.<persona>`, and that persona node has the ring.
7. **Full control room.** Select a task node again and click "Open full control room".
   - The URL becomes `?run=r_…` and the three-column control room shows. Its nav pill still reads "New run" until Task 8.
   - Go back with `evaluate_script` `() => history.back()`. The scan page returns with the same `node=`.
8. **Keyboard.** Click the ScanBar heading, then `press_key` Tab repeatedly, with a snapshot after each press.
   - Focus reaches the site node button and then T1.
   - `press_key` Enter on T1 sets `node=t0`.
   - A screenshot shows the 2px white focus outline on the focused node.
9. **Zoom and focus.** Click "Zoom in" (the canvas control) 4 times, then Tab across nodes until one that was out of view is focused.
   - The canvas pans it into view.
   - Nodes and edges stay aligned: no edge floats off its node.
   - `evaluate_script` `() => document.querySelector('.scan-flow .react-flow').scrollTop` returns `0`.
   - Click "Fit": everything is back in view.
10. **Console.** `list_console_messages` shows no errors. React Flow warnings `001` to `015` count as failures.

- [ ] **Step 14: Check the scan page at 375px**

1. `emulate` with `viewport: "375x812x2,mobile,touch"`, then reload `?scan=<id>`.
2. Take a screenshot. The ScanBar wraps with the clock under the title. The canvas is 420px tall, and the side panel stacks below it.
3. `evaluate_script`: `() => [document.documentElement.scrollWidth <= innerWidth, [...document.querySelectorAll('main, aside, section')].every(e => e.scrollWidth <= e.clientWidth + 1)]`. Expected `[true, true]`: nothing scrolls sideways.
4. Tap a persona node. The panel below shows that persona.
5. `emulate` with an empty `viewport` string, or the same call without `viewport`, to reset.

- [ ] **Step 15: Watch a fresh scan live, and the reconnecting banner**

1. Start a scan, then navigate at once to `http://localhost:5183/?scan=<new id>`. Start it with the PowerShell tool:

   ```powershell
   (Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8798/scans -ContentType "application/json" -Body '{"url":"http://127.0.0.1:8797/demo-shop/"}').scanId
   ```

2. Take a screenshot within about 3 seconds.
   - Only the site node shows, with the "Crawling" chip.
   - It shows "Read /… (n/3)" (or "Opening the site") and "n page(s) read".
   - The panel shows "Pages read so far".
3. About 5 seconds later, 10 task and 30 persona nodes appear and the canvas re-fits.
   - Persona nodes read "Queued" or "Running".
   - `evaluate_script` `() => document.querySelectorAll('.react-flow__edge.animated').length` is greater than 0 while any persona is running.
4. While it is still running, `emulate` with `networkConditions: "Offline"`.
   - Within about 8 seconds a glass "Reconnecting." banner appears.
   - The tree stays on screen.
5. `emulate` without `networkConditions` to reset. The banner disappears within about 4 seconds, and polling resumes.
6. Wait until the ScanBar chip reads "Completed". Every persona node is then terminal, and the root panel no longer shows "Partial report".

- [ ] **Step 16: Stop exactly what this task started**

1. Stop the three background tasks WORKER, ORCH and UI with TaskStop, using their task ids.
2. Confirm the ports are free (PowerShell tool):

   ```powershell
   $left = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 8797, 8798, 5183, 9239 })
   if ($left.Count -eq 0) { "all stopped" } else { $left | ForEach-Object { taskkill /PID $_.OwningProcess /T /F } }
   ```

   Run it until it prints `all stopped`. These four ports were free before Step 11, so any listener left on them is a child this task started, for example `workerd`. Never touch 8787, 8788 or 5173.

- [ ] **Step 17: Commit**

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && git add apps/control-room/package.json pnpm-lock.yaml apps/control-room/src/lib/scanLayout.ts apps/control-room/src/components/scan apps/control-room/src/index.css apps/control-room/src/App.tsx && git status --short && git commit -F - <<'EOF'
feat(control-room): scan page with a React Flow node tree beside the side panel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

Expected: only the listed files are staged. `apps/control-room/dist/` is gitignored.

---

### Task 8: Control room — one-button home page

**Files:**
- Create: `apps/control-room/src/components/ScanForm.tsx`
- Delete: `apps/control-room/src/components/RunForm.tsx`
- Modify: `apps/control-room/src/components/Landing.tsx` (full replacement)
- Modify: `apps/control-room/src/App.tsx` (full replacement, final form)
- Modify: `apps/control-room/src/lib/api.ts` (full replacement, final form)
- Modify: `apps/control-room/src/components/icons.tsx` (remove `Wand`)
- Modify: `apps/control-room/src/lib/config.ts` (one comment)
- Modify: `apps/control-room/index.html` (two comment lines)

**Interfaces:**
- **Consumes:**
  - `api.startScan`, `api.listScans`, `api.orchestratorHealth`
  - from `@friction/shared`: `normalizeTargetUrl(input): string | null`, `GOLDEN_RUN_ID`, `PERSONAS`, and the types `ScanListItem` (`ScanRecord & { tasksPassed: number; tasksTotal: number }`) and `OrchestratorHealth`
  - `SCAN_STATUS` (Task 6), `ScanPage` (Task 7)
  - the redesign's `Nav`, `HeroPreview`, `Chip`, `Dot`, `Tone`, `shortUrl`, `timeAgo`
  - icons: `ArrowRight`, `PERSONA_GLYPHS`, `Play`, `Plus`, `Sparkle`
- **Produces:**
  - `ScanForm({ onStarted: (scanId: string) => void; onReplayGolden: () => void })`
  - `Landing({ onOpenScan: (scanId: string) => void; onOpenRun: (runId: string, replay: boolean) => void; onOverHero?: (over: boolean) => void })`
  - `App` in its final form
  - `api` without `startRun`, `createRunOnWorker`, `suggestTasks` and `listRuns`

- [ ] **Step 1: Create `apps/control-room/src/components/ScanForm.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { normalizeTargetUrl } from "@friction/shared";
import { api } from "../lib/api";
import { ArrowRight } from "./icons";

interface Props {
  onStarted: (scanId: string) => void;
  onReplayGolden: () => void;
}

const STORAGE_KEY = "friction:last-scan-url";
/** The URL + task form's key; its URL seeds the field once. */
const LEGACY_KEY = "friction:last-run-form";

function loadUrl(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved;
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? "null") as { url?: unknown } | null;
    return typeof legacy?.url === "string" ? legacy.url : "";
  } catch {
    return "";
  }
}

type Failure = { kind: "invalid" } | { kind: "unreachable"; detail: string };

/** One field, one button: Friction picks the tasks. Lives in the landing hero. */
export function ScanForm({ onStarted, onReplayGolden }: Props) {
  const [url, setUrl] = useState(loadUrl);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, url);
    } catch {
      /* private mode: not worth failing over */
    }
  }, [url]);

  async function start(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const target = normalizeTargetUrl(url);
    if (!target) {
      setFailure({ kind: "invalid" });
      field.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const { scanId } = await api.startScan(target);
      onStarted(scanId);
    } catch (err) {
      setFailure({ kind: "unreachable", detail: err instanceof Error ? err.message : "unknown error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void start(event)} className="glass rounded-card border border-hairline/15 p-3 shadow-subtle sm:p-4" aria-label="Scan a site" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={field}
          type="text"
          inputMode="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (failure?.kind === "invalid") setFailure(null);
          }}
          aria-invalid={failure?.kind === "invalid"}
          aria-describedby={failure ? "scan-form-error" : undefined}
          placeholder="https://your-store.com"
          aria-label="Website URL"
          autoComplete="url"
          spellCheck={false}
          className="field h-14 min-w-0 flex-1 px-6 font-mono text-body tracking-normal"
        />
        <button type="submit" disabled={busy} className="pill-cta h-14 shrink-0 px-6 text-body">
          {busy ? "Starting…" : "Scan & test"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </div>

      <p className="mt-3 px-2 text-caption text-ash">Friction reads the site, picks its 10 most critical tasks and runs each one with all three personas.</p>

      {failure && (
        <p id="scan-form-error" role="alert" className="mt-2 px-2 text-caption text-sev-5">
          {failure.kind === "invalid" ? (
            "Enter a website URL, like https://your-store.com."
          ) : (
            <>
              Couldn't start the scan ({failure.detail}). Is the orchestrator running?{" "}
              <button type="button" onClick={onReplayGolden} className="text-white underline">
                Replay the golden run
              </button>
            </>
          )}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Delete the URL + task form**

Run: `cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && git rm apps/control-room/src/components/RunForm.tsx`
Expected: `rm 'apps/control-room/src/components/RunForm.tsx'`.

- [ ] **Step 3: Replace `apps/control-room/src/components/Landing.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { GOLDEN_RUN_ID, PERSONAS, type OrchestratorHealth, type PersonaId, type ScanListItem } from "@friction/shared";
import { api } from "../lib/api";
import { shortUrl, timeAgo } from "../lib/format";
import { SCAN_STATUS } from "../lib/scan";
import { Chip, Dot, type Tone } from "./badges";
import { HeroPreview } from "./HeroPreview";
import { ArrowRight, PERSONA_GLYPHS, Play, Plus, Sparkle } from "./icons";
import { ScanForm } from "./ScanForm";

interface Props {
  onOpenScan: (scanId: string) => void;
  onOpenRun: (runId: string, replay: boolean) => void;
  /** Whether the floating nav currently sits over the hero. */
  onOverHero?: (over: boolean) => void;
}

type Probe<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "down" };

/** One line per persona for the hero; the full descriptions live in the control room. */
const PERSONA_LINES: Record<PersonaId, string> = {
  impatient: "gives up after two failed attempts.",
  cautious: "reads every label, thrown by modals.",
  keyboard: "Tab, Enter and arrows. Never the mouse.",
};

const HOW_IT_WORKS: { title: string; detail: string }[] = [
  {
    title: "Read the site",
    detail: "One browser session opens your URL and up to five pages from its navigation, keeping each page's title and accessibility tree.",
  },
  {
    title: "Pick the ten critical tasks",
    detail:
      "One model call reads those pages and ranks the ten tasks the site exists for: revenue, conversion, finding key information and getting help. Each says why it matters and what the final page shows when it is done. Nothing logs in, pays or enters personal data.",
  },
  {
    title: "Thirty isolated browsers",
    detail:
      "Every task runs with all three personas, each in its own Browserbase session and context, so no cookies leak between them. Sessions come from one shared pool, most critical task first.",
  },
  {
    title: "Observe, plan, act",
    detail:
      "Every step starts with a screenshot and the accessibility tree. One model call picks a single action in the persona's own voice, the action runs, and the evidence is kept. Each persona is capped at 15 steps.",
  },
  {
    title: "Detect friction deterministically",
    detail:
      "Nine pure detectors run after every step: dead clicks, navigation loops, retries, step budget, error messages, modal interrupts, long waits, keyboard traps and ambiguous labels. The model never decides whether something happened; it only writes the judgement.",
  },
  {
    title: "Merge and rank",
    detail:
      "The same problem hit by several runs becomes one issue: same kind of friction, same page, same element. Issues are ranked by severity, then by how many of the thirty runs hit them, each with its screenshot and what to fix.",
  },
  {
    title: "Replay anywhere",
    detail: "Any single run plays back client-side from one request. No orchestrator, no model, no wifi.",
  },
];

export function Landing({ onOpenScan, onOpenRun, onOverHero }: Props) {
  const [scans, setScans] = useState<Probe<ScanListItem[]>>({ status: "loading" });
  const [health, setHealth] = useState<Probe<OrchestratorHealth>>({ status: "loading" });
  const scroller = useRef<HTMLElement>(null);
  const hero = useRef<HTMLElement>(null);

  useEffect(() => {
    const main = scroller.current;
    if (!main || !onOverHero) return;
    let frame = 0;
    const check = (): void => {
      frame = 0;
      // The nav's lower edge sits 64px from the top of the viewport.
      onOverHero((hero.current?.getBoundingClientRect().bottom ?? 0) > 64);
    };
    const onScroll = (): void => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    check();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      onOverHero(true);
    };
  }, [onOverHero]);

  useEffect(() => {
    let cancelled = false;
    api
      .listScans()
      .then((body) => !cancelled && setScans({ status: "ok", value: body.scans }))
      .catch(() => !cancelled && setScans({ status: "down" }));
    api
      .orchestratorHealth()
      .then((body) => !cancelled && setHealth({ status: "ok", value: body }))
      .catch(() => !cancelled && setHealth({ status: "down" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main ref={scroller} className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth motion-reduce:scroll-auto">
      {/* ---------------------------------------------------------------- hero */}
      <section ref={hero} className="horizon relative isolate overflow-hidden rounded-b-panel">
        <div aria-hidden="true" className="horizon-scrim pointer-events-none absolute inset-0 -z-10" />

        <div className="mx-auto max-w-300 px-4 pt-24 sm:px-6">
          <ServiceStatus scans={scans} health={health} />

          <h1 className="mt-8 max-w-[21ch] text-[clamp(40px,5.2vw,64px)] leading-[1.04] tracking-[-0.035em] text-white text-balance lg:max-w-none">
            <span className="lg:block">Autonomous QA that finds the flaw, </span>
            <span className="lg:block">writes the fix, and opens the PR</span>
          </h1>

          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-end gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="pb-10 lg:pb-14">
              <ul className="flex flex-col gap-3" aria-label="The three personas">
                {PERSONAS.map((persona) => {
                  const Glyph = PERSONA_GLYPHS[persona.id];
                  return (
                    <li key={persona.id} className="flex items-start gap-3 text-body text-bone">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-icon bg-white text-black">
                        <Glyph size={13} />
                      </span>
                      <span>
                        <span className="text-white">{persona.displayName}</span> <span className="text-bone/80">{PERSONA_LINES[persona.id]}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="dusk-pool mt-7">
                <ScanForm onStarted={onOpenScan} onReplayGolden={() => onOpenRun(GOLDEN_RUN_ID, true)} />

                <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 px-1 text-ui text-white">
                  <span>No site handy?</span>
                  <button type="button" onClick={() => onOpenRun(GOLDEN_RUN_ID, true)} className="pill-ghost h-8 border-white/40 bg-void/45 text-white">
                    <Play size={12} />
                    Replay the golden run
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenRun(GOLDEN_RUN_ID, false)}
                    className="pill-ghost h-8 border-white/40 bg-void/45 text-white"
                    title="Watch the Worker stream the golden fixture over server-sent events"
                  >
                    Stream it over SSE
                  </button>
                </div>
              </div>
            </div>

            <div className="-mx-2 sm:mx-0">
              <HeroPreview />
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- how it works */}
      <section id="how" className="mx-auto grid max-w-300 scroll-mt-24 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:py-20">
        <div className="self-start lg:sticky lg:top-28">
          <h2 className="font-heading text-[32px] font-medium leading-[1.15] tracking-tight text-bone text-balance sm:text-heading">
            Every step is observed, planned, acted on and judged.
          </h2>
          <p className="mt-5 max-w-[46ch] text-subheading text-ash">
            Enter a URL. Friction reads the site, picks the ten tasks that matter most, and has three personas attempt each one in isolated Browserbase
            sessions on the live site. Findings from all thirty runs are merged into one ranked report with screenshot evidence.
          </p>
        </div>

        <ol className="flex flex-col gap-5 lg:pt-2">
          {HOW_IT_WORKS.map((item, index) => (
            <li key={item.title}>
              <details className="group" open={index === 4}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-ui py-1 text-subheading text-bone transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
                  <span>{item.title}</span>
                  <span className="flex shrink-0 items-center gap-3 text-ash">
                    <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                    <Plus size={14} className="transition-transform duration-300 ease-out group-open:rotate-45" />
                  </span>
                </summary>
                <p className="max-w-[60ch] pb-1 pt-2 text-body text-ash">{item.detail}</p>
              </details>
            </li>
          ))}
        </ol>
      </section>

      {/* -------------------------------------------------------- recent scans */}
      <section id="scans" className="mx-auto max-w-300 scroll-mt-24 px-4 pb-24 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-heading text-[32px] font-semibold leading-tight tracking-tight text-bone">Recent scans</h2>
          {scans.status === "ok" && scans.value.length > 0 && <p className="text-caption text-smoke">Ten tasks per scan, three personas each.</p>}
        </div>

        <div className="relative mt-6 overflow-hidden rounded-card border border-hairline/10 bg-white/4">
          <div aria-hidden="true" className="wash absolute inset-x-0 top-0 h-px" style={{ backgroundPosition: "50% 0" }} />
          {scans.status === "loading" && <p className="px-6 py-6 text-body text-smoke">Loading scans…</p>}
          {scans.status === "down" && (
            <p className="px-6 py-6 text-body text-ash">The Worker is not answering, so past scans are unavailable. The golden run still plays: it is bundled into this app.</p>
          )}
          {scans.status === "ok" && scans.value.length === 0 && <p className="px-6 py-6 text-body text-ash">No scans yet. Start one above.</p>}
          {scans.status === "ok" && scans.value.length > 0 && (
            <ul>
              {scans.value.map((scan) => {
                const status = SCAN_STATUS[scan.status];
                return (
                  <li key={scan.id} className="border-b border-hairline/10 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => onOpenScan(scan.id)}
                      className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left transition-colors hover:bg-white/3 sm:flex-nowrap sm:px-6"
                    >
                      <span className="w-28 shrink-0">
                        <Chip tone={status.tone}>{status.label}</Chip>
                      </span>
                      <span className="min-w-0 flex-1 basis-60">
                        <span className="block truncate font-mono text-body tracking-normal text-bone group-hover:text-white" title={scan.url}>
                          {shortUrl(scan.url)}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-caption tracking-normal text-smoke">
                          {scan.id} · {timeAgo(scan.createdAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-ui tabular-nums text-ash">
                        {scan.tasksTotal > 0 ? (
                          <>
                            <span className="text-white">
                              {scan.tasksPassed}/{scan.tasksTotal}
                            </span>{" "}
                            tasks passed
                          </>
                        ) : scan.status === "failed" ? (
                          "No tasks ran"
                        ) : (
                          "Reading the site"
                        )}
                      </span>
                      <ArrowRight size={16} className="shrink-0 text-smoke transition-colors group-hover:text-white" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <footer className="mx-auto max-w-300 px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline/10 py-8 text-caption text-smoke">
          <span className="flex items-center gap-2">
            <Sparkle size={14} className="text-bone" />
            Friction. Built for Hack the North 2026.
          </span>
          <span>Every run replays with the wifi off.</span>
        </div>
      </footer>
    </main>
  );
}

function probeTone(probe: Probe<unknown>): Tone {
  return probe.status === "ok" ? "good" : probe.status === "down" ? "bad" : "idle";
}

/** The status banner: what the demo laptop can reach right now. */
function ServiceStatus({ scans, health }: { scans: Probe<ScanListItem[]>; health: Probe<OrchestratorHealth> }) {
  const mock = health.status === "ok" && health.value.mode !== "live";
  const orchestrator =
    health.status === "ok" ? `Orchestrator ${health.value.mode === "live" ? "live" : `in ${health.value.mode} mode`}` : health.status === "down" ? "Orchestrator offline" : "Orchestrator";
  const worker = scans.status === "ok" ? "Worker online" : scans.status === "down" ? "Worker offline" : "Worker";
  const title = health.status === "ok" && health.value.missingEnv.length > 0 ? `Mock mode. Missing: ${health.value.missingEnv.join(", ")}` : undefined;

  return (
    <div className="flex justify-center">
      <p
        role="status"
        title={title}
        className="glass inline-flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-nav border border-hairline/20 px-4 py-1.5 text-center text-ui text-bone"
      >
        <Sparkle size={14} className="shrink-0 text-white" />
        <span className="inline-flex items-center gap-2">
          <Dot tone={probeTone(scans)} size={7} />
          {worker}
        </span>
        <span className="inline-flex items-center gap-2">
          <Dot tone={mock ? "warn" : probeTone(health)} size={7} />
          {orchestrator}
        </span>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Replace `apps/control-room/src/App.tsx` with its final form**

```tsx
import { useCallback, useMemo, useState } from "react";
import { GOLDEN_RUN_ID, PERSONA_IDS, type PersonaId, type StepPayload } from "@friction/shared";
import { Landing } from "./components/Landing";
import { Nav } from "./components/Nav";
import { PersonaColumn } from "./components/PersonaColumn";
import { ReportView } from "./components/ReportView";
import { RunBar } from "./components/RunBar";
import { Play, Plus, Sparkle } from "./components/icons";
import { ScanPage } from "./components/scan/ScanPage";
import { useReport } from "./hooks/useReport";
import { useRunStream } from "./hooks/useRunStream";
import { snapshotFromView, summarize } from "./lib/runState";
import { useQuery, type Tab } from "./lib/useQuery";

export default function App() {
  const [query, setQuery] = useQuery();
  const [overHero, setOverHero] = useState(true);

  // The single-run view only: a scan page streams its selected persona node itself.
  const runId = query.scan ? null : query.run;
  const stream = useRunStream(runId, { replay: query.replay });
  const { view } = stream;
  const summary = summarize(view);

  // Whatever is on screen, as a snapshot: lets the report be built with no Worker.
  const localSnapshot = useMemo(() => stream.snapshot ?? snapshotFromView(view), [stream.snapshot, view]);
  const report = useReport(runId, query.tab === "report", localSnapshot, {
    localOnly: stream.origin === "bundled",
    refreshKey: summary.frictionCount + (summary.phase === "complete" ? 1000 : 0),
  });

  const findStep = useCallback(
    (personaId: PersonaId, seq: number): StepPayload | undefined => {
      const live = view.personas[personaId].steps.find((step) => step.seq === seq);
      if (live) return live.payload;
      const recorded = stream.snapshot?.events.find((e) => e.type === "step" && e.personaId === personaId && e.seq === seq);
      return recorded?.type === "step" ? recorded.payload : undefined;
    },
    [view, stream.snapshot],
  );

  const goHome = useCallback(() => setQuery({ run: null, scan: null, node: null, replay: false, tab: "room" }), [setQuery]);
  const openScan = useCallback((scanId: string) => setQuery({ scan: scanId, node: null, run: null, replay: false, tab: "room" }), [setQuery]);
  const openRun = useCallback(
    (id: string, replay = false) => setQuery({ run: id, scan: null, node: null, replay, tab: "room" }),
    [setQuery],
  );
  const selectNode = useCallback((node: string) => setQuery({ node }), [setQuery]);

  // Every view but the landing carries the same white pill: scans start on the home page.
  const newScan = (
    <button type="button" onClick={goHome} className="pill-cta h-8.5 px-3.5 text-ui sm:px-4" aria-label="New scan">
      <Plus size={14} />
      <span className="hidden sm:inline">New scan</span>
    </button>
  );

  if (query.scan) {
    return (
      <div className="flex h-full flex-col">
        <Nav onHome={goHome} compact action={newScan} />
        <ScanPage key={query.scan} scanId={query.scan} nodeId={query.node} onSelectNode={selectNode} onOpenRun={openRun} />
      </div>
    );
  }

  if (!runId) {
    return (
      <div className="flex h-full flex-col">
        <Nav
          onHome={goHome}
          frosted={overHero}
          action={
            <button type="button" onClick={() => openRun(GOLDEN_RUN_ID, true)} className="pill-cta h-8.5 px-4 text-ui">
              <Play size={12} />
              Watch the demo
            </button>
          }
        >
          <a href="#how" className="pill-ghost hidden border-transparent md:inline-flex">
            How it works
          </a>
          <a href="#scans" className="pill-ghost hidden border-transparent md:inline-flex">
            Recent scans
          </a>
        </Nav>
        <Landing onOpenScan={openScan} onOpenRun={openRun} onOverHero={setOverHero} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Nav onHome={goHome} compact action={newScan}>
        <TabButton tab="room" current={query.tab} onTab={(tab) => setQuery({ tab })}>
          <span className="sm:hidden">Room</span>
          <span className="hidden sm:inline">Control room</span>
        </TabButton>
        <TabButton tab="report" current={query.tab} onTab={(tab) => setQuery({ tab })}>
          Report
          {summary.frictionCount > 0 && (
            <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/12 px-1.5 text-[12px] tabular-nums text-white">
              {summary.frictionCount}
            </span>
          )}
        </TabButton>
      </Nav>

      <RunBar
        view={view}
        origin={stream.origin}
        connection={stream.connection}
        elapsedMs={stream.elapsedMs}
        replay={stream.replay}
        isReplay={query.replay}
        onToggleReplay={() => setQuery({ replay: !query.replay })}
      />

      {stream.notice && (
        <div className="flex shrink-0 justify-center px-4 pt-4">
          <p role="status" className="glass inline-flex max-w-3xl items-start gap-2.5 rounded-nav border border-hairline/20 px-4 py-2 text-ui text-bone">
            <Sparkle size={14} className="mt-0.75 shrink-0 text-white" />
            <span>
              <span className="text-white">Heads up.</span> {stream.notice}
            </span>
          </p>
        </div>
      )}

      {query.tab === "report" ? (
        <ReportView report={report.report} loading={report.loading} local={report.local} findStep={findStep} />
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 pb-4 pt-5 sm:px-6 sm:pb-6 lg:grid-cols-3 lg:overflow-hidden">
          {PERSONA_IDS.map((id) => (
            <PersonaColumn key={id} persona={view.personas[id]} allowLiveView={stream.origin === "live"} startTs={view.firstTs} />
          ))}
        </main>
      )}
    </div>
  );
}

function TabButton({ tab, current, onTab, children }: { tab: Tab; current: Tab; onTab: (tab: Tab) => void; children: React.ReactNode }) {
  const active = tab === current;
  return (
    <button
      type="button"
      onClick={() => onTab(tab)}
      aria-current={active ? "page" : undefined}
      className={`pill-ghost ${active ? "" : "border-transparent text-white/70"}`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 5: Replace `apps/control-room/src/lib/api.ts` with its final form (the calls nothing uses are removed)**

```ts
import type {
  CreateScanResponse,
  OrchestratorHealth,
  ReportResponse,
  RunSnapshot,
  ScanListResponse,
  ScanReportResponse,
  ScanTreeResponse,
} from "@friction/shared";
import { ORCHESTRATOR_URL, WORKER_URL } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page */
    }
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${response.status}`;
      throw new ApiError(message, response.status);
    }
    return body as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const aborted = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(aborted ? "request timed out" : "network unreachable", null);
  } finally {
    window.clearTimeout(timer);
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * The UI starts scans only. The orchestrator's POST /runs and POST
 * /suggest-tasks remain for scripts (smoke-local.ts); nothing here calls them.
 */
export const api = {
  /** Starts the crawl, task generation and every persona run in the background; answers with the scan id at once. */
  startScan: (url: string) => request<CreateScanResponse>(`${ORCHESTRATOR_URL}/scans`, json({ url }), 12_000),

  orchestratorHealth: () => request<OrchestratorHealth>(`${ORCHESTRATOR_URL}/health`, undefined, 2500),

  listScans: () => request<ScanListResponse>(`${WORKER_URL}/api/scans?limit=12`, undefined, 5000),
  getScanTree: (scanId: string) => request<ScanTreeResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}`, undefined, 6000),
  getScanReport: (scanId: string) =>
    request<ScanReportResponse>(`${WORKER_URL}/api/scans/${encodeURIComponent(scanId)}/report`, undefined, 8000),

  getSnapshot: (runId: string) => request<RunSnapshot>(`${WORKER_URL}/api/runs/${encodeURIComponent(runId)}`, undefined, 6000),
  getReport: (runId: string) => request<ReportResponse>(`${WORKER_URL}/api/runs/${encodeURIComponent(runId)}/report`, undefined, 6000),

  streamUrl(runId: string, after: string): string {
    const base = `${WORKER_URL}/api/runs/${encodeURIComponent(runId)}/stream`;
    return after ? `${base}?after=${encodeURIComponent(after)}` : base;
  },

  /** Keys are built from [A-Za-z0-9._/-] only, so they are already URL-safe. */
  evidenceUrl: (key: string): string => `${WORKER_URL}/api/evidence/${key}`,
};
```

- [ ] **Step 6: Remove the `Wand` icon from `apps/control-room/src/components/icons.tsx`**

Delete this block, together with the blank line before it:

```tsx
export const Wand = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3.5 16.5 9-9M11 6l3 3" />
    <path d="M15 2.5v3M13.5 4h3M16.5 10v2M15.5 11h2" strokeWidth={1.3} />
  </Icon>
);
```

- [ ] **Step 7: Update two comments**

1. In `apps/control-room/src/lib/config.ts`, replace:

   ```ts
   /** Node orchestrator: starts runs and suggests tasks. The UI works without it. */
   ```

   with:

   ```ts
   /** Node orchestrator: starts scans. Replays, reports and past scans work without it. */
   ```

2. In `apps/control-room/index.html`, replace the line:

   ```
         STORY: A judge sees the product running before reading a word, grasps three personas on one task, then watches exactly where each one fights the site.
   ```

   with:

   ```
         STORY: A judge sees the product running before reading a word, grasps three personas on each of a site's ten most critical tasks, then watches exactly where each one fights the site.
   ```

   Then replace the line:

   ```
         FIRST VIEWPORT: Full-bleed horizon hero. Status pill centred; 72px headline across the top; left, three persona rows and the frosted run form with the white Start pill; right, a device frame rising from the bottom edge, replaying the golden run live.
   ```

   with:

   ```
         FIRST VIEWPORT: Full-bleed horizon hero. Status pill centred; 72px headline across the top; left, three persona rows and the frosted scan form (one large URL field, the white Scan & test pill); right, a device frame rising from the bottom edge, replaying the golden run live.
   ```

- [ ] **Step 8: Confirm nothing still references what was removed**

Run:

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && grep -rnE "RunForm|StartedRun|startRun|createRunOnWorker|suggestTasks|listRuns|Wand|Suggest tasks" apps/control-room/src || echo "clean"
```

Expected: `clean`.

- [ ] **Step 9: Typecheck and build**

Run: `pnpm --filter @friction/control-room typecheck`
Expected: exit 0.

Run: `pnpm --filter @friction/control-room build`
Expected: success.

- [ ] **Step 10: Start the three apps on the verification ports**

Do exactly what Task 7 Steps 10 and 11 did:

1. **Check the ports.** Run the PowerShell `$busy` check. Expected: `ports free`.
2. **Start** these three with the Bash tool (`run_in_background: true`), noting their task ids WORKER, ORCH and UI:
   ```bash
   cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && pnpm --filter @friction/worker exec wrangler dev --port 8797 --inspector-port 9239
   ```
   ```bash
   cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && PORT=8798 WORKER_URL=http://127.0.0.1:8797 FRICTION_MOCK=1 MOCK_SPEED=1 pnpm --filter @friction/orchestrator start
   ```
   ```bash
   cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && VITE_WORKER_URL=http://127.0.0.1:8797 VITE_ORCHESTRATOR_URL=http://127.0.0.1:8798 pnpm --filter @friction/control-room exec vite --port 5183 --strictPort
   ```
3. **Wait for readiness.** Run the PowerShell readiness loop from Task 7 Step 11. Expected: three `ready: True` lines, then `mock`.

- [ ] **Step 11: Check the home page in a browser**

Use the Chrome DevTools MCP tools.
1. **Hero.** `new_page` `http://localhost:5183/` at 1440 × 900 and take a screenshot. The horizon hero shows:
   - "Autonomous QA that finds the flaw, writes the fix, and opens the PR", on two lines at 1440 px with no orphaned word
   - three persona rows
   - the glass form with one mono URL field and one white **Scan & test** pill
   - the "No site handy?" row
   - the device preview replaying the golden run
2. **Form contents.** `evaluate_script` `() => [document.querySelectorAll('main form input').length, [...document.querySelectorAll('button')].some(b => /Suggest tasks/.test(b.textContent ?? ''))]`. Expected `[1, false]`.
3. **Status pill.** It reads "Worker online" and "Orchestrator in mock mode".
4. **Invalid URL.** `fill` the URL field with `not a url` and press Enter.
   - A coral line reads "Enter a website URL, like https://your-store.com."
   - The field has `aria-invalid="true"` and keeps focus (`document.activeElement === document.querySelector('main form input')`).
5. **Start a scan.** `fill` it with `http://127.0.0.1:8797/demo-shop/` and press Enter. The URL becomes `?scan=s_…` at once, and the site node shows "Crawling" with crawl progress. The nav shows the logo and a white "New scan" pill.
6. **Recent scans.** Click "New scan". Home loads again, with the URL field prefilled with `http://127.0.0.1:8797/demo-shop/`.
   - "Recent scans" lists that scan first, with its status chip, mono URL, id and time ago.
   - Once it has finished (about 2 minutes), a reload shows "N/10 tasks passed".
   - Clicking the row opens `?scan=<id>`.
7. **Golden run.** Navigate to `http://localhost:5183/?run=golden&replay=1`. The three-column control room plays, and the nav pill reads "New scan".
8. **375px.**
   - `emulate` `viewport: "375x812x2,mobile,touch"`, then reload home.
   - The URL field and the Scan & test pill stack.
   - `evaluate_script` `() => document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth` returns `true`.
   - Take a screenshot. Then reset the viewport.
9. **Orchestrator down.**
   - Stop **only** the ORCH background task with TaskStop.
   - Confirm 8798 no longer listens: `@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -eq 8798).Count` returns `0`. If not, `taskkill /PID <that OwningProcess> /T /F`.
   - Click **Scan & test** with a valid URL. A coral line reads "Couldn't start the scan (network unreachable). Is the orchestrator running? Replay the golden run".
   - Click "Replay the golden run". `?run=golden&replay=1` plays.
10. **Worker down.** Stop **only** the WORKER background task, confirm 8797 and 9239 no longer listen (the same check), then reload home.
    - The status pill reads "Worker offline" and "Orchestrator offline".
    - Recent scans reads "The Worker is not answering, so past scans are unavailable. …"
11. **Console.** `list_console_messages` shows no errors other than the expected failed fetches from steps 9 and 10.

- [ ] **Step 12: Stop exactly what this task started**

1. TaskStop the UI background task, and WORKER and ORCH if they are still running.
2. Run the PowerShell `$left` loop from Task 7 Step 16 until it prints `all stopped`. Never touch 8787, 8788 or 5173.

- [ ] **Step 13: Commit**

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && git add apps/control-room/src/components/ScanForm.tsx apps/control-room/src/components/Landing.tsx apps/control-room/src/App.tsx apps/control-room/src/lib/api.ts apps/control-room/src/components/icons.tsx apps/control-room/src/lib/config.ts apps/control-room/index.html && git status --short && git commit -F - <<'EOF'
feat(control-room): one-button Scan & test home page; the scan replaces URL + task

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

Expected:
- `git status --short` shows `D  apps/control-room/src/components/RunForm.tsx` (staged by `git rm`), and the modified and added files staged.
- The commit succeeds.

---

### Task 9: Docs and full verification

**Files:**
- Modify: `README.md` (intro, architecture diagram, a Scans paragraph, item 1, item 6, two ownership rows, verified / not verified)
- Modify: `SETUP.md` ("You want to..." table, checks line, env table, migrations note, runbook step 3, Browserbase concurrency bullet, new "Scans: time and cost" section)
- Modify: `.env.example` (`MAX_SESSIONS`)
- Modify: `apps/control-room/PRODUCT.md` (full replacement)
- Modify: `apps/control-room/DESIGN.md` (targeted edits and two new sections)

**Interfaces:**
- Consumes (documented facts, all as built in Tasks 1–8):
  - orchestrator: `POST /scans`, `crawl.ts`, `taskGen.ts`, `scanManager.ts`
  - `MAX_SESSIONS` (default 3, range 1–100), with `PERSONA_CONCURRENCY` still read as a fallback
  - Worker: `GET /api/scans/:id` and `/report`, and migrations `0001` and `0002` applied independently
  - UI: `packages/shared/src/scanReport.ts`, `?scan=<id>&node=<nodeId>`, and the `smoke:scan` script
- Produces: docs only.

- [ ] **Step 1: Update `README.md`**

1. Replace line 3 (the paragraph after `# Friction`):

   ```markdown
   Give it a URL and a task. Three AI personas attempt the task at the same time, each in its own isolated Browserbase browser, on the live site. Friction is detected as it happens, streamed to a control room, and ranked in a report with screenshot evidence. Built for Hack the North 2026.
   ```

   with:

   ```markdown
   Give it a URL. Friction reads the site, picks the 10 most critical tasks to QA, and has three AI personas attempt each one, each in its own isolated Browserbase browser, on the live site: 30 runs. Friction is detected as it happens, shown as a live node tree (site → tasks → persona runs), and merged into one site-wide report that ranks each issue by severity and by how many runs hit it, with screenshot evidence. Built for Hack the North 2026.
   ```

2. Replace the three diagram lines inside the code block under `## Architecture`:

   ```
   control-room (Vite/React) --POST /runs--> orchestrator (Node/Express) --events, evidence--> worker (Cloudflare)
           ^                                   | one Browserbase session + context per persona      | D1: runs, personas, events, findings
           +------------- SSE / replay / report / evidence ------------------------------------------+ R2: screenshots
   ```

   with:

   ```
   control-room (Vite/React) --POST /scans--> orchestrator (Node/Express) --scans, runs, events, evidence--> worker (Cloudflare)
           ^                                    | crawl, 10 tasks, 30 persona sessions from one pool          | D1: scans, runs, personas, events, findings
           +--- scan tree (poll) / SSE per run / replay / reports / evidence ---------------------------------+ R2: screenshots
   ```

3. Directly after that code block's closing fence, and before the line starting `1. The control room POSTs`, insert:

   ```markdown
   **Scans.** The home page has one field and one button. **Scan & test** POSTs `{url}` to the orchestrator (`POST /scans`), which creates the scan on the Worker and returns its id at once. One browser session reads the landing page and up to five same-origin navigation pages (`crawl.ts`). One Structured Outputs call turns that into up to 10 ranked tasks, each with why it is critical and what success looks like (`taskGen.ts`). Each task then becomes an ordinary run, as below, and its planner judges completion against that success check. All 30 personas queue for one process-wide pool of `MAX_SESSIONS` browser sessions, most critical task first; a persona waiting for a session shows as **Queued**. The scan page (`?scan=<id>&node=<nodeId>`) draws the site, its tasks and their persona runs as a React Flow node tree. It polls `GET /api/scans/:id` every 2s, streams only the persona node you select (the same SSE and `PersonaColumn` a run uses), and shows `GET /api/scans/:id/report`. There, findings from every run are merged into issues by category, page and element, and ranked by severity, then by how many of the 30 runs hit them (`packages/shared/src/scanReport.ts`). If the site cannot be read or the model call fails, the scan runs 10 generic tasks and says so. In mock mode the crawl is scripted, the tasks are canned and every run replays the golden run.

   Each run works as follows:

   ```

4. Replace:

   ```markdown
   1. The control room POSTs `{url, task}` to the orchestrator, which creates the run on the Worker and returns a `runId` at once.
   ```

   with:

   ```markdown
   1. The run is created on the Worker with `{url, task}` (plus its scan link when it belongs to a scan) and gets a `runId` at once. The orchestrator's `POST /runs {url, task}` still starts a single run directly; the UI no longer calls it, but scripts and `smoke-local.ts` do.
   ```

5. In item 6, replace the opening words:

   ```markdown
   6. The control room renders three live columns
   ```

   with:

   ```markdown
   6. A single run's control room (`?run=<id>`, linked from every task's panel on the scan page) renders three live columns
   ```

   Leave the rest of that item unchanged.

6. In the "Who owns what" table, replace the **A** row:

   ```markdown
   | **A** | Orchestrator | `apps/orchestrator` | Browserbase sessions, Stagehand, OpenAI planner + judge, persona loop, `/suggest-tasks`. Tune prompts in `planner.ts`; page-side measurement lives in `pageScripts.ts` |
   ```

   with:

   ```markdown
   | **A** | Orchestrator | `apps/orchestrator` | Browserbase sessions, Stagehand, OpenAI planner + judge, persona loop, scans (`crawl.ts`, `taskGen.ts`, `scanManager.ts`), `/suggest-tasks`. Tune prompts in `planner.ts`; page-side measurement lives in `pageScripts.ts` |
   ```

   Then replace the **C** row:

   ```markdown
   | **C** | Control room | `apps/control-room` | React UI. State is one reducer (`lib/runState.ts`) fed by `hooks/useRunStream.ts`. Works against the fixture with nothing else running |
   ```

   with:

   ```markdown
   | **C** | Control room | `apps/control-room` | React UI in the dusk design system (`DESIGN.md`). A run's state is one reducer (`lib/runState.ts`) fed by `hooks/useRunStream.ts`; a scan polls `hooks/useScan.ts` and draws `components/scan/`. Single runs work against the fixture with nothing else running |
   ```

7. Replace the first "Verified" bullet:

   ```markdown
   - `pnpm typecheck` (4 packages, strict) and `pnpm test` (42 detector tests: the detectors reproduce exactly the 11 findings recorded in the fixture, incrementally, on the very event that evidences each).
   ```

   with:

   ```markdown
   - `pnpm typecheck` (4 packages, strict) and `pnpm test` (42 detector tests: the detectors reproduce exactly the 11 findings recorded in the fixture, incrementally, on the very event that evidences each; plus unit tests for the scan contracts and the merged site report).
   ```

   Then, after the bullet starting `- Crash isolation:`, add:

   ```markdown
   - A full mock scan, via `pnpm --filter @friction/orchestrator smoke:scan`: a scripted crawl, 10 tasks and 30 persona runs through the real pipeline, and a merged report in which one issue is hit by at least 10 of the 30 runs. The scan page was checked in a browser at desktop width and at 375px.
   ```

8. In the "Not verified" paragraph, replace `the three OpenAI calls (planner, judge, suggest-tasks) and Browserbase session creation` with `the four OpenAI calls (planner, judge, suggest-tasks, scan task generation), the live crawl, and Browserbase session creation`.

- [ ] **Step 2: Update `SETUP.md`**

1. Replace the whole "You want to..." table (its header row through the `| Replay a past run | … |` row) with:

   ```markdown
   | You want to... | Do this |
   | --- | --- |
   | See the UI with zero setup | Click **Replay the golden run**, or open `/?run=golden&replay=1` |
   | Exercise the whole pipeline with no keys | Start all three apps, enter any URL, **Scan & test** (mock mode: a scripted crawl, 10 canned tasks, 30 runs that replay the golden run through the real pipeline), or run `pnpm --filter @friction/orchestrator smoke:scan` |
   | Test the real browser loop with no keys | `pnpm --filter @friction/orchestrator smoke` (Worker must be running; drives a local Chrome/Edge with a scripted planner against the built-in demo shop) |
   | Do a real scan | Fill in `.env` (below), restart the orchestrator, **Scan & test**. Read [Scans: time and cost](#scans-time-and-cost) first |
   | Reopen a scan | Landing page > **Recent scans**, or `/?scan=<id>` (add `&node=t2` or `&node=t2.keyboard` to select a node) |
   | Watch one run of a scan in full | Select its task node, then **Open full control room**, or open `/?run=<id>` |
   | Replay a past run | `/?run=<id>&replay=1` |
   ```

2. Replace the checks line:

   ```
   pnpm test                # friction detector unit tests against the fixture (42 tests)
   ```

   with:

   ```
   pnpm test                # detector tests against the fixture, plus scan contract and merged-report tests
   ```

3. Replace the env-table row:

   ```markdown
   | `PERSONA_CONCURRENCY` | | `3` | Personas at once. Lower it if your Browserbase plan caps concurrent sessions |
   ```

   with:

   ```markdown
   | `MAX_SESSIONS` | | `3` | Browser sessions open at once across every run and scan (1-100): a scan's crawl and every persona take one. Set it to your Browserbase plan's concurrency limit. `PERSONA_CONCURRENCY` is still read as a fallback |
   ```

4. In the D1 migrations paragraph, replace:

   ```markdown
   it runs `migrations/0001_init.sql` itself
   ```

   with:

   ```markdown
   it runs any of `migrations/*.sql` it is missing itself
   ```

5. Replace runbook step 3:

   ```markdown
   3. If you want to go live and the network cooperates, start a run. If it does not, `FRICTION_MOCK=1` gives a live-looking run through the real pipeline.
   ```

   with:

   ```markdown
   3. If you want to go live and the network cooperates, start a scan. If it does not, `FRICTION_MOCK=1` gives a live-looking scan through the real pipeline.
   ```

6. Replace the Browserbase concurrency bullet:

   ```markdown
   - **Browserbase concurrency.** Three personas means three concurrent sessions. On a plan that allows fewer, session creation returns 429; the orchestrator waits and retries, but set `PERSONA_CONCURRENCY=1` to be safe. "Suggest tasks" opens a fourth session.
   ```

   with:

   ```markdown
   - **Browserbase concurrency.** A scan opens one session to crawl, then 30 persona sessions, never more than `MAX_SESSIONS` at once; the rest wait as **Queued**, most critical task first. A single run's three personas share the same pool. On a plan that allows fewer sessions, session creation returns 429 and the orchestrator waits and retries, but set `MAX_SESSIONS` to your plan's limit. `POST /suggest-tasks` (API only now) opens a session outside the pool.
   ```

7. Directly before the line `## Deploy the Worker`, insert:

   ```markdown
   ## Scans: time and cost

   A live scan is up to 30 persona runs (10 tasks x 3 personas) of up to 15 steps each. That is roughly 450+ planner calls with a screenshot each, plus a judge call per friction finding, plus one task-generation call, plus the crawl's one browser session. At `MAX_SESSIONS=3` expect roughly 20-50 minutes per scan; raise `MAX_SESSIONS` to your Browserbase plan's concurrency limit to go faster. Point it at `/demo-shop` first. Mock mode (`FRICTION_MOCK=1`, or no keys) costs nothing and finishes in about a minute.

   ```

- [ ] **Step 3: Update `.env.example`**

Replace these two lines:

```
# Personas running at once (1-3, default 3). Lower it if your Browserbase plan caps concurrent sessions.
# PERSONA_CONCURRENCY=3
```

with:

```
# Browser sessions open at once across every run and scan (1-100, default 3): a scan's crawl and
# every persona take one. Set it to your Browserbase plan's concurrency limit.
# (PERSONA_CONCURRENCY, the old name, is still read as a fallback.)
# MAX_SESSIONS=3
```

- [ ] **Step 4: Replace `apps/control-room/PRODUCT.md`**

```markdown
# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary, for now: the Hack the North 2026 demo audience. Judges watch a presenter replay a run on the demo laptop or a projector, often from across a room. The landing page has seconds to make the idea land, and the control room has to be legible at distance.

Secondary: founders and product teams pointing Friction at their own site to find where it fights back.

## Product Purpose

Give Friction a URL and press **Scan & test**. It reads the site, picks the ten tasks that matter most, and has three AI personas attempt each one, each in its own isolated Browserbase browser, on the live site: thirty runs. Friction is detected as it happens, shown as a live node tree (site, tasks, persona runs), and merged into one site report that ranks each issue by severity and by how many runs hit it, with screenshot evidence. Success is a viewer who sees exactly where and why a real user would give up.

## Positioning

Three distinct users (Impatient power user, Cautious first-timer, Keyboard-only user) run each of a site's ten most critical tasks side by side on the live site, and the same problem hit by many runs becomes one issue. Detection is deterministic: nine pure detectors decide *whether* friction happened, and the model only writes the judgement. Every finding carries the screenshot with the target boxed.

## Operating Context

- The demo is **replay**; live is the bonus. `/?run=<id>&replay=1` needs only the local Worker: no orchestrator, OpenAI, Browserbase or wifi. There is no bundled golden scan: a scan needs the Worker, and the golden run replay stays the offline fallback on the home page.
- Fallback chain for a single run: orchestrator, then Worker (streams the golden fixture), then the golden run compiled into this bundle.
- Views: landing (scan a site, recent scans, service status), scan page (the node tree beside a side panel: the merged site report, one task, or one persona's live run), control room (one run's three persona columns with live view, current action, timeline, friction alerts), report (one run's ranked findings with evidence).
- The URL is the app state: `?scan=<id>[&node=<nodeId>]` for a scan (node ids `root`, `t<index>`, `t<index>.<personaId>`), and `?run=<id>[&replay=1][&tab=report]` for a single run.

## Capabilities and Constraints

- **Must render with the wifi off.** No runtime CDN, font, or image fetches; fonts are bundled.
- Up to 10 tasks per scan, three personas each: at most 30 runs.
- Hard cap of 15 steps per persona.
- Severity scale S1 to S5: Cosmetic, Minor, Moderate, Major, Blocker.
- Friction categories: dead click, navigation loop, retry, step budget, error message, modal interrupt, long wait, keyboard trap, ambiguous label.
- Persona states: idle (shown as queued in a scan), running, succeeded, failed, timed out.

## Brand Commitments

- Name: Friction. Headline in use: "Autonomous QA that finds the flaw, writes the fix, and opens the PR"
- Visual world pinned by the user (2026-09-19): the "Dimension" dusk-lit dark workspace reference (void canvas, frosted glass, pill controls, DM Sans 500 display, Geist headings, amber-to-cobalt hero gradient, violet only as a wash or glow).
- Severity and state colors are sampled from the dusk gradient (S5 hot coral through S1 cool cobalt); no hues outside it. Succeeded reads as plain white; running carries the violet wash.

## Evidence on Hand

- The golden run (`fixtures/golden-run.json`): 65 events, 11 findings, wireframe screenshots rendered locally from step payloads.
- No customers, testimonials, metrics or pricing exist. Do not invent them.

## Product Principles

- The demo cannot strand the presenter: every view has something truthful to show when a service is down, and says which fallback is on screen.
- Show the evidence, not a claim about it.
- Honesty about data source: fixture, replay, live, offline and mock scans are always labelled.

## Accessibility & Inclusion

A keyboard-only persona is part of the product, so the control room itself must be fully keyboard operable with visible focus: every node on the scan canvas is reached with Tab and selected with Enter. Respect reduced motion.
```

- [ ] **Step 5: Update `apps/control-room/DESIGN.md`**

Apply these edits in this order. Each replaces the exact original text.

1. Line 3:
   - Old: `description: Three users. One task. Every place your site fights back.`
   - New: `description: Autonomous QA that finds the flaw, writes the fix, and opens the PR`
2. In the Headline hierarchy bullet:
   - Old: `section heads ("Recent runs", "Findings",`
   - New: `section heads ("Recent scans", "Findings",`
3. Replace the Card bullet.
   - Old: `- **Card** (24px): persona columns, finding cards, the recent-runs list, the run form.`
   - New: `- **Card** (24px): persona columns, finding and issue cards, the recent-scans list, the scan form, the scan canvas frame and the site node. Task nodes step in to 16px.`
4. In the Primary (white pill) bullet:
   - Old: `Used for the run's main verb: Start run, Watch the demo, New run, Play/Pause.`
   - New: `Used for the region's main verb: Scan & test, Watch the demo, New scan, Play/Pause. On the landing scan form it grows to 56px tall with 16px text, matching the large URL field.`
5. In the Ghost pill bullet:
   - Old: `used for nav tabs, persona filters and suggested tasks.`
   - New: `used for nav tabs and persona filters. At 28px tall with caption text they are a merged issue's occurrence chips ("T3 · Keyboard"), each selecting that persona node.`
6. Old: `- **Recent-runs card:**` → New: `- **Recent-scans card:**`
7. In the Inputs Style bullet:
   - Old: `The URL field is set in Geist Mono at 14px.`
   - New: `The URL field is set in Geist Mono at 14px; the landing scan field is the large variant, 56px tall with 24px side padding and Geist Mono at 16px.`
8. Replace the three Navigation bullets `- **Landing:** …`, `- **Run views:** …` and `- **Mobile:** …` with:

   ```markdown
   - **Landing:** "How it works" and "Recent scans" links (hidden below 768px) and a "Watch the demo" white pill.
   - **Run views:** "Control room" and "Report" tabs (the report tab carries a count badge) and a white "New scan" pill. The scan form never appears here.
   - **Scan page:** no tabs; the white "New scan" pill only.
   - **Mobile:** on run and scan views the wordmark becomes screen-reader-only, the tab shortens to "Room", and "New scan" collapses to its plus icon.
   ```

9. In the Horizon Hero paragraph:
   - Old: `then the frosted run form on its dusk pool: URL and task fields, a ghost "Suggest tasks" pill on 35% void, and the white "Start run" pill.`
   - New: `then the frosted scan form on its dusk pool: one large URL field and the white "Scan & test" pill, with an ash line under them saying what a scan does.`
10. In Don't:
    - Old: `- **Don't** place the run form outside the landing hero; run views get the floating nav with tabs and a white "New run" pill.`
    - New: `- **Don't** place the scan form outside the landing hero; scan and run views get the floating nav and a white "New scan" pill.`
11. Replace every remaining occurrence of `run form` with `scan form`. After edits 1–10 there are four, in the Frost, Landing layout, Elevation and Inset hairline paragraphs.
12. Directly before the line starting `**Report.** The same 1200px container`, insert:

    ```markdown
    **Scan page.** Under the floating nav, the scan bar: status and data-source chips, the mono URL, the site as a title, and the run clock with "N/30 runs done" beneath it. From 1024px the canvas and the side panel sit side by side: the canvas fills the remaining width in a 24px-cornered hairline frame on void, and the 460px side panel scrolls on its own. Below 1024px the canvas is a fixed 420px tall, the panel stacks under it, and the page scrolls.

    ```

13. Directly before the line `### Evidence Image`, insert:

    ```markdown
    ### Scan Canvas (signature)
    The site, its tasks and their persona runs as a node tree on void, fixed left to right: the site node, the task column, then each task's three persona rows. The dot grid is 24px apart in a 12% hairline. Edges are 1px hairlines at 18%; an edge into a running persona is a moving dash in 70% white, frozen under reduced motion. Every node is a button on opaque graphite, so the grid never shows through. Tab reaches it and Enter selects it. The selected node gets a 1px white ring set 4px off its edge, which keeps it distinct from the 2px focus outline. On hover its text lifts from bone to white.
    - **Site node:** a 24px-cornered card: the scan's status chip, the host in Geist, then crawl progress while reading, or task verdicts (a status light each), issue totals and runs done once tasks exist; a failure in coral, the generic-tasks notice in amber.
    - **Task node:** a 16px-cornered card: its rank in mono ash, a strip of three marks (a white check for succeeded, a coral cross for failed, an amber cross for timed out, the running glow, the idle light), the task in two lines, and its finding count. Its 1px border takes the worst severity's hue, or a 15% hairline when nothing was found.
    - **Persona node:** a 44px pill: the white glyph tile, the persona's short name, steps as mono "7/15", the finding count beside one dot in the worst severity's hue (slate at zero), and the state badge with idle read as "Queued".
    - **Canvas controls:** a graphite pill at the bottom left holding zoom in, zoom out and Fit as ghost buttons.
    - **Side panel:** the site report (verdict tiles, tasks completed per persona, the severity spectrum in five equal columns, then ranked issue cards with a reach line and occurrence pills), a task (why it matters, what success looks like, persona rows, its issues, a ghost pill to the full control room), or one persona (the Persona Column, then its evidence cards). Notices are 3% boxes with a status light. A lost Worker shows the glass notice pill with a breathing amber light.

    ```

`.impeccable/design.json` is generated from DESIGN.md by the impeccable tooling, so do not hand-edit it.

- [ ] **Step 6: Proofread the doc diff**

Run: `cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && git diff --stat && grep -n "run form\|Suggest tasks\|One task\|PERSONA_CONCURRENCY" apps/control-room/DESIGN.md apps/control-room/PRODUCT.md SETUP.md .env.example`

Expected:
- `--stat` lists exactly `README.md`, `SETUP.md`, `.env.example`, `apps/control-room/PRODUCT.md` and `apps/control-room/DESIGN.md`.
- The grep prints only the SETUP.md `MAX_SESSIONS` row and the `.env.example` line that name `PERSONA_CONCURRENCY` as the fallback.

- [ ] **Step 7: Run every static check**

Run in Git Bash, one at a time:

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && pnpm typecheck
```

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && pnpm test
```

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && pnpm build && (grep -l "url(http" apps/control-room/dist/assets/*.css || echo "no remote CSS urls")
```

Expected:
- `pnpm typecheck` exits 0 for all four packages.
- `pnpm test` passes every test: the detector tests plus `scan.test.ts` and `scanReport.test.ts`.
- `pnpm build` succeeds and prints `no remote CSS urls`.

- [ ] **Step 8: Start the three apps on the verification ports**

1. **Check the ports.** Run the PowerShell `$busy` check from Task 7 Step 10. Expected: `ports free`. If not, stop and report; do not kill.
2. **Start** these three with the Bash tool (`run_in_background: true`), noting their task ids WORKER, ORCH and UI:
   ```bash
   cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && pnpm --filter @friction/worker exec wrangler dev --port 8797 --inspector-port 9239
   ```
   ```bash
   cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && PORT=8798 WORKER_URL=http://127.0.0.1:8797 FRICTION_MOCK=1 MOCK_SPEED=1 pnpm --filter @friction/orchestrator start
   ```
   ```bash
   cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && VITE_WORKER_URL=http://127.0.0.1:8797 VITE_ORCHESTRATOR_URL=http://127.0.0.1:8798 pnpm --filter @friction/control-room exec vite --port 5183 --strictPort
   ```
3. **Wait for readiness.** Run the PowerShell readiness loop from Task 7 Step 11. Expected: three `ready: True` lines and `mock`.

- [ ] **Step 9: End-to-end mock scan**

Run with the Bash tool (timeout 300000 ms):

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && ORCHESTRATOR_URL=http://127.0.0.1:8798 WORKER_URL=http://127.0.0.1:8797 pnpm --filter @friction/orchestrator smoke:scan
```

Expected output:
- `completed`, with `pages=3 tasks=10 runs done=30/30`
- `report: … widest hit <w>/30 runs` with `w ≥ 10`
- `OK  open http://localhost:5173/?scan=<id>`

Use port **5183**.

- [ ] **Step 10: Final browser pass, desktop (1440 × 900)**

Use the Chrome DevTools MCP tools.
1. **Home** (`http://localhost:5183/`):
   - one URL field and one **Scan & test** pill
   - the status pill reads "Worker online" and "Orchestrator in mock mode"
   - Recent scans lists the smoke scan with "N/10 tasks passed"
2. **Start a scan** from the home page with `http://127.0.0.1:8797/demo-shop/`.
   - The scan page opens at once, with the site node crawling and "Pages read so far" in the panel.
   - 40 more nodes appear, and the canvas re-fits.
   - Personas go Queued → Running (animated edges) → terminal.
   - The ScanBar reads "X/30 runs done" with a ticking clock.
   - The root panel shows "Partial report: …" until completion.
3. **Smoke scan** (`?scan=<smoke id>`):
   - **Root panel:** verdict tiles, "N of 10" per persona, severity columns, and issue cards reading "Hit in N/30 runs · K tasks · …".
   - **Occurrence chip:** it selects its persona node.
   - **Task node:** the task panel shows Why / Success / three persona rows and "Open full control room" (which opens `?run=r_…`; Back returns).
   - **Persona row:** the live `PersonaColumn` and evidence screenshots.
4. **Keyboard:** Tab reaches the site node, then the task nodes. Enter selects: `?node=` changes and the ring moves. The focus outline is visible.
5. **Offline assets:** `list_network_requests` shows only `localhost:5183`, `127.0.0.1:8797` and `127.0.0.1:8798`, and no font or CDN hosts.
6. **Console:** `list_console_messages` shows no errors.

- [ ] **Step 11: Final browser pass at 375px**

1. `emulate` `viewport: "375x812x2,mobile,touch"`.
2. On the home page: the form stacks, and `document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth` is `true`.
3. On `?scan=<smoke id>`:
   - the ScanBar wraps
   - the canvas is 420px tall and the panel stacks below it
   - `document.documentElement.scrollWidth <= innerWidth` is `true`
   - tapping a task node, then a persona row, updates the panel below
4. Take a screenshot of each page. Then reset the viewport.

- [ ] **Step 12: Stop exactly what this task started**

1. TaskStop WORKER, ORCH and UI.
2. Run the PowerShell `$left` loop from Task 7 Step 16 until it prints `all stopped`. Never touch 8787, 8788 or 5173.

- [ ] **Step 13: Commit the docs**

```bash
cd /c/Users/ryany/OneDrive/Desktop/friction/.claude/worktrees/site-scan && git add README.md SETUP.md .env.example apps/control-room/PRODUCT.md apps/control-room/DESIGN.md && git status --short && git commit -F - <<'EOF'
docs: scans, MAX_SESSIONS, time and cost; product and design docs follow the scan flow

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 14: Report honestly**

State plainly what was **not** exercised: the live crawl and the task-generation model call. Both need `OPENAI_API_KEY`, `OPENAI_MODEL` and Browserbase keys. Also note that reduced motion was not emulated: the Chrome DevTools MCP `emulate` tool has no `prefers-reduced-motion` option, so the edge, breathe and sweep rules were checked by reading the CSS only.

---

## Self-review

**Spec coverage (Control room, Merged report UI, Error handling UI, Docs):**

| Spec requirement | Where |
| --- | --- |
| `useQuery` gains `scan`, `node`; `?run=` keeps working | Task 6 Step 2; Task 7 Step 8; Task 8 Step 4 |
| Node ids `root`, `t<i>`, `t<i>.<persona>`; unknown → root | `scanNodeId` / `parseScanNode` everywhere; `resolveScanNode` (Task 6 Step 3); `SidePanel` fallback |
| Header only logo + wordmark home | `Nav` with a "New scan" pill (Design decision 4); Task 7 Step 8, Task 8 Step 4 |
| Home: large URL field, one Scan & test, Enter submits, inline invalid error, last URL remembered | `ScanForm` (Task 8 Step 1) |
| On submit `POST /scans` → `?scan=`; orchestrator unreachable → inline error + golden replay link | `ScanForm.start`, `App.openScan`; Task 8 Step 11.9 |
| Recent scans: status, URL, "N/M tasks passed", time ago, click opens; Worker down → one-line note | `Landing` recent scans (Task 8 Step 3); Step 11.6, 11.10 |
| Health dots and golden replay link kept | `ServiceStatus`, "No site handy?" row, "Watch the demo" |
| Scan page top bar: URL, status, X/30 runs done, elapsed | `ScanBar` (Task 7 Step 6) |
| `ScanGraph` on `@xyflow/react`, the only new dep; fixed columns 0/320/660; task centred on its 3-row block, root centred | Task 7 Steps 1–2 |
| Fit on load and when tasks first appear; pan/zoom on; nodes not draggable | `fitView` + `FitOnGrow`; `nodesDraggable={false}` (Task 7 Step 4) |
| Nodes focusable, Enter selects | buttons in `nodes.tsx`; `reveal` + scroll reset; Task 7 Step 13.8–9 |
| Side panel about 460px; stacks under a fixed-height canvas below lg | `ScanPage` `lg:w-115`, `h-105` (Task 7 Step 7); Step 14 |
| RootNode / TaskNode / PersonaNode content per the table | `nodes.tsx` (Task 7 Step 3) |
| Edges into running personas animated; the selected node gets a ring | `scanLayout` `animated`; `frame(selected)` ring |
| Root panel: merged report + collapsible crawled pages; while crawling, the pages | `RootPanel` (Task 6 Step 11) |
| Task panel: title, why, success check, 3 persona rows selecting nodes, the task's issues, Open full control room | `TaskPanel` (Task 6 Step 12) |
| Persona panel: `PersonaColumn` via `useRunStream(runId)`, `allowLiveView` when live, findings with `EvidenceImage`; switching selection switches the stream | `PersonaPanel` (Task 6 Step 13); `SidePanel` keyed by run id |
| `useScan`: 2s poll, stops at completed/failed, keeps the tree + reconnecting banner, 404 → not found | Task 6 Step 4; `ScanPage` banner; Task 7 Step 15.4–5 |
| `useScanReport` refetches on finding count and on completion | Task 6 Step 5; `ScanPage` `refreshKey` (Design decision 8) |
| Report UI: summary (verdicts, persona success, severity counts), ranked cards with severity badge + category, reach line, summary + recommendation, representative screenshot, occurrence chips selecting nodes, marked partial while running | `RootPanel.ReportBody`, `IssueCard`, "Partial report" notice |
| Fallback: root node says "Couldn't read the site; these tasks are generic" | `RootNode`, `RootPanel` notice, ScanBar chip |
| Worker refuses runs → `failed` with message; the root node shows it | `RootNode` coral message; `RootPanel` bad notice |
| Worker refuses the scan → 502 → inline error on home | `ScanForm` unreachable branch shows the 502 message |
| Docs: README architecture; SETUP env table (`MAX_SESSIONS`), "You want to...", cost and time; README says what is unverified without keys | Task 9 Steps 1–3; PRODUCT.md / DESIGN.md Steps 4–5 |

**Placeholder scan.** Every code step shows complete code, or exact old and new text. There is no "TBD" and no "similar to Task N". The start and stop commands are repeated in full in Tasks 7, 8 and 9, or name the exact earlier step whose exact script to re-run.

**Name consistency:** these names are identical across all four tasks:
- `SCAN_STATUS`, `VERDICT`, `VERDICT_ORDER`, `SCAN_STATE_LABELS`
- `resolveScanNode`, `runProgress`, `totalFindings`, `worstSeverity`, `verdictCounts`, `personaShortName`, `hostOf`
- `ScanPoll`, `layoutScan`, `LayoutOptions`
- `RootFlowNode`, `TaskFlowNode`, `PersonaFlowNode`, `ScanFlowNode`
- `ScanGraph`, `ScanBar`, `ScanPage`, `SidePanel`, `IssueCard`, `Notice`, `ScanForm`

**Checked against the real files:**
- Existing component props, checked against their files: `Chip`, `Dot`, `Tone`, `SEVERITY_STYLES` (`text`, `dot`, `box`, `ring`), `SeverityBadge`, `StateBadge`, `EvidenceImage.source`, `PersonaColumn`, `Nav`
- `@friction/shared` exports, checked against `scan.ts`: `ScanListItem`, `TaskSource`, `CrawledPage`, `ScanTreePersona`
- React Flow APIs, checked against the published 12.11.6 types:
  - `NodeTypes`
  - `FitViewOptions.duration`
  - `SetCenterOptions.zoom`
  - `PanelPosition "bottom-left"`
  - the `null` key-code props
  - `colorMode`
  - the node wrapper's `pointerEvents: hasPointerEvents ? 'all' : 'none'` and `data-id`
