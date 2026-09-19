# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary, for now: the Hack the North 2026 demo audience. Judges watch a presenter replay a run on the demo laptop or a projector, often from across a room. The landing page has seconds to make the idea land, and the control room has to be legible at distance.

Secondary: founders and product teams pointing Friction at their own site to find where it fights back.

## Product Purpose

Give Friction a URL and press **Scan & test**. It reads the site, picks the five tasks that matter most, and has one agent, a competent first-time visitor, attempt each one in its own isolated Browserbase browser on the live site. Friction is detected as it happens, shown as a live node tree (site, tasks), and merged into one site report that ranks each issue by severity and by how many tasks hit it, with screenshot evidence. For each task's worst findings, a fix is proposed and proven by re-running the task with it installed. Success is a viewer who sees exactly where and why a real user would give up.

## Positioning

One neutral agent runs each of a site's ten most critical tasks on the live site, and the same problem hit by many tasks becomes one issue. A fix is only called verified once a re-run proves it. Detection is deterministic: nine pure detectors decide *whether* friction happened, and the model only writes the judgement. Every finding carries the screenshot with the target boxed.

## Operating Context

- The demo is **replay**; live is the bonus. `/?run=<id>&replay=1` needs only the local Worker: no orchestrator, OpenAI, Browserbase or wifi. There is no bundled golden scan: a scan needs the Worker, and the golden run replay stays the offline fallback on the home page.
- Fallback chain for a single run: orchestrator, then Worker (streams the golden fixture), then the golden run compiled into this bundle.
- Views: landing (scan a site, recent scans), scan page (the node tree beside a side panel: the merged site report, or one task with its live run), control room (one run's live pane with live view, current action, timeline, friction alerts; a second pane while a fix is verified), report (one run's fix comparisons and ranked findings with evidence).
- The URL is the app state: `?scan=<id>[&node=<nodeId>]` for a scan (node ids `root`, `t<index>`; an old `t<index>.<personaId>` link opens that task), and `?run=<id>[&replay=1][&tab=report]` for a single run.

## Capabilities and Constraints

- **Must render with the wifi off.** No runtime CDN, font, or image fetches; fonts are bundled.
- Up to 5 tasks per scan, one run each, plus up to `VERIFY_TOP_N` verification runs per task.
- Hard cap of 15 steps per run.
- Severity scale S1 to S5: Cosmetic, Minor, Moderate, Major, Blocker.
- Friction categories: dead click, navigation loop, retry, step budget, error message, modal interrupt, long wait, keyboard trap, ambiguous label.
- Agent states: idle (shown as queued in a scan), running, succeeded, failed, timed out. A run whose agent is done may still be verifying fixes.

## Brand Commitments

- Name: Friction. Headline in use: "Three users. One task. Every place your site fights back."
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

The agent may use the keyboard and keyboard traps are a detected category, so the control room itself must be fully keyboard operable with visible focus: every node on the scan canvas is reached with Tab and selected with Enter. Respect reduced motion.
