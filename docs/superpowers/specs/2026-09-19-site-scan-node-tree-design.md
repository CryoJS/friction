# Site scan + node tree: design

Date: 2026-09-19
Status: approved in brainstorming, awaiting spec review

## Goal

Replace "enter a URL and a task" with a single action: enter a URL, press **Scan & test**. Friction crawls the site, picks the 10 most critical tasks to QA, and runs each task with the same three personas (impatient, cautious, keyboard): 10 task groups x 3 personas = 30 agent runs. Results are shown as a node tree (site -> tasks -> persona runs) on a pan/zoom canvas, with a side panel for whichever node is selected, and one site-wide report that merges repeated issues across all 30 runs.

## User flow

1. Home page: a large URL field and one **Scan & test** button. Recent scans are listed below.
2. Clicking it opens the scan page at once. The canvas shows only the site root node, with crawl progress ("Reading /pricing... 3/6 pages").
3. About 30-60s later the 10 task nodes and their 30 persona nodes appear, all **queued**.
4. Persona nodes turn **running** (with a pulse and an animated edge), then **succeeded / failed / timeout**. Task nodes show a ✓/✗ strip and take a border colour from their worst severity.
5. The site report on the root node fills in as findings arrive. When all 30 runs have finished, the scan is **completed**.
6. Clicking any node shows its detail in the side panel. The selected node is in the URL, so every view can be linked to.

## Scope

In scope:

- scan pipeline: crawl, task generation, fan-out
- Worker storage and routes for scans
- home page redesign
- scan page with graph canvas and side panel
- merged site report
- mock-mode support for all of the above
- a global browser-session cap

Out of scope (deliberately):

- A bundled offline "golden scan" fixture. The single golden-run replay stays available from the home page.
- Recovering scans that were in progress when the orchestrator restarts. Single runs have the same limitation today.
- A step to review or edit the generated tasks before they run. The flow is one button by design.
- Tasks that start from a page other than the scanned URL. Every run starts at the scanned URL.
- An SSE stream for the scan tree. It polls instead; see the Control room section.

## Architecture (approach A: a scan is the parent of 10 ordinary runs)

A scan owns a URL, crawl state and up to 10 tasks. Each task is a normal run (`url`, `task`, three personas), created and driven exactly as runs are today. These stay unchanged:

- the event contract (`events.ts`)
- the detectors (`friction.ts`)
- per-run SSE (`stream.ts`, `hub.ts`)
- per-run report assembly
- `PersonaColumn`

```
control room --POST /scans {url}--> orchestrator --scan + runs + events--> Worker (D1, R2)
     ^                                    |
     |                                    | 1. crawl      one session: landing + up to 5 same-origin nav pages
     |                                    | 2. plan       one model call -> up to 10 ranked tasks
     |                                    | 3. fan out    create 10 runs, post idle for all 30 personas,
     |                                    |               run 30 persona jobs behind ONE global session pool
     |                                    | 4. finish     PATCH scan -> completed
     |
     +-- poll GET /api/scans/:id (tree) every 2s; GET /api/scans/:id/report
     +-- existing SSE GET /api/runs/:id/stream for the run of the selected persona node
```

Approaches rejected:

- **One run with 30 agents.** This widens `PersonaId` and changes everything keyed on it in all four packages.
- **Orchestration in the browser.** The grouping would be lost when the tab closes, and there would be no scan history.

## Data model (Worker, D1)

New migration `apps/worker/migrations/0002_scans.sql`. Every statement is idempotent (`CREATE ... IF NOT EXISTS`); there is no `ALTER TABLE`.

```sql
CREATE TABLE IF NOT EXISTS scans (
  id           TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'crawling',  -- crawling | running | completed | failed
  message      TEXT,                              -- human-readable progress or failure reason
  pages        TEXT NOT NULL DEFAULT '[]',        -- JSON: [{ url, title }] crawled so far
  task_source  TEXT,                              -- 'model' | 'fallback' | 'mock', null while crawling
  created_at   INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS scan_tasks (
  scan_id       TEXT NOT NULL,
  task_index    INTEGER NOT NULL,    -- 0-based rank, 0 = most critical
  run_id        TEXT NOT NULL,
  why_critical  TEXT NOT NULL,
  success_check TEXT NOT NULL,
  PRIMARY KEY (scan_id, task_index)
);

CREATE INDEX IF NOT EXISTS idx_scan_tasks_run ON scan_tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at);
```

The task title is the run's existing `task` column.

`ensureSchema` in `apps/worker/src/db.ts` is extended so the migrations are applied independently:

- apply `0001` when the `findings` table is missing
- apply `0002` when the `scans` table is missing

**Note:** `db.ts` has an uncommitted fix that splits the schema file on `\r?\n`. The extension must keep that fix, ideally by moving the split into a shared helper both migrations use.

## Shared contracts (`packages/shared/src/scan.ts`, exported from the index)

Types:

- `ScanStatus = "crawling" | "running" | "completed" | "failed"`
- `CreateScanRequestSchema` (zod): `{ url }`, with the same validation as `CreateRunRequestSchema.url`.
- `CreateScanResponse`: `{ scanId }`
- `ScanRecord`: `{ id, url, status, message, pages: { url, title }[], taskSource: "model" | "fallback" | "mock" | null, createdAt, completedAt }`
- `ScanPatchSchema` (zod, orchestrator -> Worker): all fields optional.
  - `status`, `message`, `taskSource`
  - `page` (one `{url, title}` to append)
- `GeneratedTaskSchema` (zod): `{ title, whyCritical, successCheck }`
  - `title`: an imperative sentence. The prompt asks for at most 14 words; the schema only caps it at 160 characters, so a 15-word task is still run
  - `whyCritical`: one sentence
  - `successCheck`: what the final page shows when the task is done
- `ScanTreeResponse`: what the canvas polls.
  ```ts
  {
    scan: ScanRecord;
    tasks: Array<{
      index: number; runId: string; title: string; whyCritical: string; successCheck: string;
      personas: Array<{ personaId: PersonaId; state: PersonaState; stepCount: number;
                        findingCount: number; worstSeverity: Severity | null }>;  // PERSONAS order
    }>;
  }
  ```
- `ScanListResponse`: `{ scans: Array<ScanRecord & { tasksPassed: number; tasksTotal: number }> }`
- `ScanReportResponse`: see "Merged report" below.

`CreateRunRequestSchema` gains an optional `scan: { scanId, taskIndex, whyCritical, successCheck }`. When it is present, the Worker also inserts the `scan_tasks` row. This is an additive change; existing callers are unaffected.

Pure helpers, all unit-tested:

- `pickCrawlLinks(baseUrl, hrefs, max = 5)` returns up to `max` absolute URLs.
  - keeps same-origin http(s) links only
  - drops `#` fragments, `mailto:` and `tel:` links
  - drops file downloads (`.pdf`, `.zip`, images)
  - drops auth and account paths (`login`, `logout`, `sign-in`, `signin`, `sign-up`, `signup`, `register`, `account`, `auth`, `password`)
  - removes duplicates by normalized path, and drops the base page itself
  - keeps the input order, which is navigation order
- `taskVerdict(states: PersonaState[])` returns `"pass" | "partial" | "fail" | "pending"`.
  - `pending` if any state is not terminal
  - otherwise, by how many personas succeeded: `pass` if 3, `partial` if 1-2, `fail` if 0
- `issueKey(category, evidenceUrl, targetLabel)`
- `assembleScanReport(...)`

## Orchestrator

**New endpoint `POST /scans {url}`** returns `201 { scanId }` immediately and runs the scan in the background. `POST /runs` and `POST /suggest-tasks` stay. The UI stops calling them, but the API and `smoke-local.ts` keep working.

**New modules:**

- `crawl.ts` takes a session from the pool, opens the URL and observes it with the existing `observe()`. It then:
  - collects the hrefs inside `nav`, `header` and `[role=navigation]`, falling back to all visible anchors when there are none
  - runs them through `pickCrawlLinks`
  - visits each page with a 20s timeout, keeping its title and pruned a11y tree
  - sends the Worker a `PATCH /api/scans/:id` with `page` and `message` after each page

  A page that fails to load is skipped. The session is always closed.
- `taskGen.ts` makes one Responses API call, like `suggest.ts` does today: strict `json_schema`, model from `OPENAI_MODEL` only.
  - **Input:** the landing screenshot (the only image), plus each crawled page's URL, title and up to 60 a11y-tree lines.
  - **Instructions:** propose exactly 10 tasks, ranked most critical first. "Critical" means the core flows the site exists for: revenue, conversion, finding key information, getting help.
    - Each task must be doable in about 10 clicks, and checkable from the final page.
    - No logging in, creating an account, entering personal data or paying.
    - Adding to a cart is fine; checking out is not.
  - **Parsing:** with `GeneratedTaskSchema`. Valid tasks are kept, up to 10. If fewer than 10 are valid, only those are run, with no generic padding.
- `scanManager.ts`: the lifecycle.
  1. Create the scan on the Worker.
  2. Crawl.
  3. Generate tasks.
  4. Create one run per task through `POST /api/runs` with its `scan` link.
  5. For all 30 personas, emit an `idle` status and flush it before anything runs. The Worker treats a run with no events as producer-less and streams the golden fixture in its place, so these events must exist first. This is the same reason `RunManager.start` flushes today.
  6. PATCH the scan to `running`.
  7. Run the 30 persona jobs through the session pool, with one crash isolated from the others as in `RunManager.runAll`.
  8. PATCH the scan to `completed`.
- `RunManager` is refactored so the scan manager can reuse it. Creating a run's emitters and running its personas become separate functions, and the per-run `Semaphore` is replaced by the shared session pool.

**Session pool:**

- One process-wide `Semaphore`, sized by the new `MAX_SESSIONS` env var (default 3, range 1-100).
- `PERSONA_CONCURRENCY` is still read as a fallback, so existing `.env` files keep working.
- The crawl session and every persona session take a slot. Queued personas stay `idle`, and the UI shows that as **queued**.
- Jobs are queued in task-rank order, so the most critical tasks finish first.

**Planner:** `PlanRequest` gains an optional `successCheck`. When it is present, the prompt adds `Success looks like: <successCheck>` under `Task:`, so `taskComplete` is judged against the same check the report uses.

**Mock mode** (no keys, or `FRICTION_MOCK=1`):

- The crawl is skipped. The Worker gets a scripted progress sequence: the landing page, then 2 fake pages at mock speed.
- Tasks are 10 canned generic tasks, with `taskSource = "mock"`.
- Every persona job is `runMockPersona` (the golden run through the real pipeline).
- The session pool is bypassed, because nothing real is opened.

**Fallback tasks:** `fallbackTasks(url)` grows from 3 to 10 generic tasks, each with a `whyCritical` and `successCheck`. They are used when the landing page cannot be read or the model call fails. `taskSource` is then `"fallback"`, and the root node says "Couldn't read the site; these tasks are generic".

## Worker routes

| Route | Purpose |
| --- | --- |
| `POST /api/scans` `{url}` | Create a scan (`crawling`). Returns `{ scanId }`. |
| `PATCH /api/scans/:id` | Status, message, taskSource, or append one crawled page. Sets `completed_at` on `completed` / `failed`. |
| `GET /api/scans?limit=` | Recent scans for the home page, with tasks passed / total. |
| `GET /api/scans/:id` | `ScanTreeResponse`. |
| `GET /api/scans/:id/report` | `ScanReportResponse`, built by `assembleScanReport` from D1 rows. |
| `POST /api/runs` | Unchanged, plus the optional `scan` link. |

The tree endpoint is at most four small queries:

1. the scan row
2. `scan_tasks` joined to `runs`
3. the `personas` of those runs
4. `findings` of those runs, grouped by `(run_id, persona_id)` into a count and `MAX(severity)`

The report endpoint loads all findings for the scan's runs, joined to their evidence steps in one query, following the pattern of `getReportRows`.

## Control room

**URL state:**

- `useQuery` gains `scan` and `node`: `?scan=<id>&node=<nodeId>`.
- Node ids are `root`, `t<index>` (e.g. `t2`) and `t<index>.<personaId>` (e.g. `t2.keyboard`). A missing or unknown node means `root`.
- `?run=<id>` keeps opening today's 3-column control room.

**Header:** the URL, task and suggest form is removed. The header shows only the logo and wordmark, which link home.

**Home page (`Landing.tsx`, rewritten):**

- **Main form:** a large centered URL input and one **Scan & test** button. Enter submits. Invalid URLs get an inline error, and the last URL is remembered in localStorage, as now.
- **On submit:** `POST /scans` goes to the orchestrator, then `?scan=<id>`. If the orchestrator is unreachable, an inline error appears with a "Replay the golden run" link.
- **Recent scans:** each row shows status, URL, "7/10 tasks passed" and time ago, and clicking it opens the scan. If the Worker is down, the list is replaced with a one-line note.
- **Kept:** the Worker and orchestrator health dots, and a small "Replay the golden run" link.

**Scan page (`ScanPage.tsx`):**

- **Top bar:** site URL, status chip, "18/30 runs done", elapsed time.
- **Left: `ScanGraph`**, built on `@xyflow/react`, the only new dependency.
  - Layout is fixed left to right and computed from the tree shape, so no layout library is needed. Columns are root, tasks (x = 320) and personas (x = 660). Each task gets a 3-row block of persona nodes, with the task node centred on its block and the root centred on everything.
  - The canvas fits the view on load and when the task nodes first appear. Panning and zooming are on; nodes are not draggable.
  - Nodes are focusable, and Enter selects the focused one.
- **Right: `SidePanel`**, about 460px wide. Below the `lg` breakpoint it stacks under a fixed-height canvas.

**Node components:**

| Node | Content |
| --- | --- |
| `RootNode` | Hostname, status. While crawling: the progress message and the number of pages read so far. When running or done: tasks pass/partial/fail counts and issue totals. The generic-tasks notice when `taskSource = "fallback"`. |
| `TaskNode` | Rank, title (2-line clamp), a ✓ / ✗ / … strip for the 3 personas, finding count. Border colour = worst severity (the existing `SEVERITY_STYLES`), neutral when none. |
| `PersonaNode` | Persona short name and a state chip (queued / running with a pulse / succeeded / failed / timeout), step count, and the finding count beside one dot in the worst severity's colour. |

Edges into a running persona node are animated. The selected node gets a ring.

**Side panel by node:**

- **Root:** the merged site report (next section), plus a collapsible list of crawled pages.
- **Task:**
  - the title, why it is critical, and its success check
  - the three persona outcome rows (clicking one selects that node)
  - the site-report issues whose occurrences include this task
  - an **Open full control room** link to `?run=<runId>`
- **Persona:**
  - the existing `PersonaColumn` for that persona, fed by `useRunStream(runId)`, with `allowLiveView` when the origin is `live`
  - below it, that run's findings for this persona, with `EvidenceImage` screenshots

  Changing the selection switches the stream.

**Data hooks:**

- `useScan(scanId)` polls `GET /api/scans/:id` every 2s.
  - It stops once the status is `completed` or `failed`.
  - If a poll fails, it keeps the last tree on screen and shows a "reconnecting" banner.
- `useScanReport(scanId, refreshKey)` fetches the report. It refetches when the total finding count in the tree changes, and once more on completion.

## Merged report

`assembleScanReport({ scan, tasks, personas, findings, evidenceSteps, now })` is a pure function in `packages/shared`.

**Merging:**

- Findings share an issue when their `issueKey` matches: `category | path | label`.
  - `path` is the evidence step's URL pathname, lowercased, with the trailing slash, query string and hash removed. It is `""` when the evidence step is missing.
  - `label` is `targetLabel`, lowercased, with whitespace collapsed.
- Each issue records:
  - `severity`: the highest among its occurrences
  - `confidence`: the highest among its occurrences
  - `summary`, `whyItMatters`, `recommendation` and `evidence`: taken from the representative occurrence (highest severity, then highest confidence)
  - `runsHit`: the distinct (task, persona) pairs affected, out of `totalRuns`
  - `personas`, `taskIndexes`, `page`, `targetLabel`
  - `occurrences`: `{ runId, taskIndex, personaId, evidenceSeq, severity }[]`

**Ranking:** severity desc, then `runsHit` desc, then confidence desc, then key (a stable tiebreak).

**Summary:**

- tasks by verdict: pass / partial / fail / pending
- success per persona: e.g. `keyboard: 2 of 10`
- issues by severity

**Response shape:**

```ts
ScanReportResponse {
  scan: ScanRecord; generatedAt: number;
  summary: { verdicts: Record<"pass"|"partial"|"fail"|"pending", number>;
             personas: Record<PersonaId, { succeeded: number; finished: number; total: number }>;
             issuesBySeverity: Record<Severity, number> };
  tasks: Array<{ index: number; runId: string; title: string; verdict: TaskVerdict }>;
  issues: ScanIssue[];
}
```

**UI:** the root panel shows the summary, then the ranked issue cards. Each card shows:

- a severity badge and category
- a reach line, e.g. "Hit in 12/30 runs · 4 tasks · Keyboard"
- the summary and recommendation
- the representative screenshot
- occurrence chips like `T3 · Keyboard`, which select that node when clicked

The report renders while the scan is still running, and marks itself as partial.

## Error handling

| Failure | Behaviour |
| --- | --- |
| A nav page fails or times out during the crawl | Skipped; the crawl continues. |
| Landing page unreadable, or the task model call fails | 10 generic fallback tasks are run; `taskSource = "fallback"`; the root node says so. |
| Model returns fewer than 10 valid tasks | Only those are run; the tree has fewer groups. If 0 are valid, fallback. |
| Worker refuses to create the scan | `POST /scans` returns 502; the home page shows an inline error. |
| Worker refuses to create runs after the crawl | The scan is PATCHed to `failed` with a message. The root node shows it. |
| A persona crashes | Isolated, as today: `failed` + `done` for that persona; the scan still completes. |
| Worker unreachable while viewing | The tree keeps the last poll and shows a "reconnecting" banner; polling continues. |
| Orchestrator unreachable on submit | Inline error on the home page, plus a "Replay the golden run" link. |
| Orchestrator restarts mid-scan | Known limitation: that scan's unfinished runs stay non-terminal. Out of scope. |

## Cost and time (documented in SETUP.md)

- **Model calls:** a live scan is up to 30 runs x 15 steps. That is about 450+ planner calls with a screenshot each, plus judge calls, plus one task-generation call.
- **Time:** at `MAX_SESSIONS=3`, expect roughly 20-50 minutes per scan. Raise it to your Browserbase plan's concurrency limit.

## Testing

**Unit tests** (vitest, in `packages/shared`, alongside `friction.test.ts`):

- `pickCrawlLinks`: same-origin only, duplicates removed, auth and file links dropped, the cap, order kept.
- `taskVerdict`: every state combination.
- `issueKey` normalization.
- `assembleScanReport`: merging across tasks and personas, the highest severity and the representative occurrence, `runsHit` counting, ranking, the summary counts, and a missing evidence step. Built on a fixture of 10 copies of the golden run's findings.
- `GeneratedTaskSchema`: parsing, including dropping invalid entries.

**End to end, mock mode, no keys:**

1. Start all three apps.
2. Scan any URL from the home page.
3. Verify that:
   - the root node shows crawl progress
   - 10 task nodes and 30 persona nodes appear
   - states go from queued to running to terminal
   - `GET /api/scans/:id/report` returns merged issues with `runsHit > 1`
   - clicking root, task and persona nodes shows the right panel, including the live persona stream
4. Check it in a real browser.

**Always:** `pnpm typecheck` and `pnpm test` pass.

**Not verifiable without keys:** the live crawl and the task-generation model call. The existing planner and judge calls are in the same position; this is stated in the README.

## Docs

- **README:** the architecture section is updated for the scan flow.
- **SETUP.md:**
  - `MAX_SESSIONS` replaces `PERSONA_CONCURRENCY` in the env table
  - the "You want to..." table covers scans
  - the cost and time note above is added
