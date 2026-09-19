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
