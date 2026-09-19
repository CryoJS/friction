# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary, for now: the Hack the North 2026 demo audience. Judges watch a presenter replay a run on the demo laptop or a projector, often from across a room. The landing page has seconds to make the idea land, and the control room has to be legible at distance.

Secondary: founders and product teams pointing Friction at their own site to find where it fights back.

## Product Purpose

Give Friction a URL and a task. Three AI personas attempt the task at the same time, each in its own isolated Browserbase browser, on the live site. Friction is detected as it happens, streamed to a control room, and ranked in a report with screenshot evidence. Success is a viewer who sees exactly where and why a real user would give up.

## Positioning

Three distinct users (Impatient power user, Cautious first-timer, Keyboard-only user) run the same task side by side on the live site. Detection is deterministic: nine pure detectors decide *whether* friction happened, and the model only writes the judgement. Every finding carries the screenshot with the target boxed.

## Operating Context

- The demo is **replay**; live is the bonus. `/?run=<id>&replay=1` needs only the local Worker: no orchestrator, OpenAI, Browserbase or wifi.
- Fallback chain: orchestrator, then Worker (streams the golden fixture), then the golden run compiled into this bundle.
- Views: landing (start a run, recent runs, service status), control room (three persona columns with live view, current action, timeline, friction alerts), report (ranked findings with evidence).
- The URL is the app state: `?run=<id>[&replay=1][&tab=report]`.

## Capabilities and Constraints

- **Must render with the wifi off.** No runtime CDN, font, or image fetches; fonts are bundled.
- Hard cap of 15 steps per persona.
- Severity scale S1 to S5: Cosmetic, Minor, Moderate, Major, Blocker.
- Friction categories: dead click, navigation loop, retry, step budget, error message, modal interrupt, long wait, keyboard trap, ambiguous label.
- Persona states: idle, running, succeeded, failed, timed out.

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
- Honesty about data source: fixture, replay, live and offline are always labelled.

## Accessibility & Inclusion

A keyboard-only persona is part of the product, so the control room itself must be fully keyboard operable with visible focus. Respect reduced motion.
