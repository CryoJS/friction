---
name: Friction control room
description: Three users. One task. Every place your site fights back.
colors:
  void: "#0a0a0a"
  graphite: "#161616"
  frost: "#d4d4d4"
  white: "#ffffff"
  black: "#000000"
  bone: "#ededed"
  ash: "#c2c2c2"
  smoke: "#b2b2b2"
  slate: "#686868"
  hairline: "#e5e5e5"
  violet: "#6b62f2"
  sev-5: "#ff6b57"
  sev-4: "#ff9e4f"
  sev-3: "#f5cf7a"
  sev-2: "#a29dff"
  sev-1: "#7894ff"
typography:
  display:
    fontFamily: "'DM Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "72px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: "-0.02em"
  subheading:
    fontFamily: "'DM Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.025em"
  body:
    fontFamily: "'DM Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.025em"
  control:
    fontFamily: "'DM Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.025em"
  ui:
    fontFamily: "'DM Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.025em"
  caption:
    fontFamily: "'DM Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.33px"
  mono:
    fontFamily: "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  icon: "4px"
  ui: "10px"
  nav: "19px"
  card: "24px"
  large: "40px"
  panel: "42px"
  pill: "9999px"
spacing:
  "0.5": "2px"
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "2.5": "10px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "14": "56px"
  "16": "64px"
  "20": "80px"
  "24": "96px"
components:
  button-primary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.graphite}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.bone}"
  button-primary-nav:
    backgroundColor: "{colors.white}"
    textColor: "{colors.graphite}"
    typography: "{typography.ui}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "34px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "rgb(255 255 255 / 0.85)"
    typography: "{typography.ui}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "34px"
  button-ghost-hover:
    textColor: "{colors.white}"
  button-ghost-selected:
    backgroundColor: "rgb(255 255 255 / 0.08)"
    textColor: "{colors.white}"
  button-ghost-on-horizon:
    backgroundColor: "rgb(10 10 10 / 0.45)"
    textColor: "{colors.white}"
    typography: "{typography.ui}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "32px"
  input-field:
    backgroundColor: "rgb(10 10 10 / 0.42)"
    textColor: "{colors.white}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "46px"
  input-field-focus:
    backgroundColor: "rgb(10 10 10 / 0.6)"
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.smoke}"
    typography: "{typography.caption}"
    rounded: "{rounded.ui}"
    padding: "2px 8px"
  badge-state:
    backgroundColor: "transparent"
    textColor: "{colors.bone}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "28px"
  badge-severity-s5:
    backgroundColor: "transparent"
    textColor: "{colors.sev-5}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  status-pill:
    backgroundColor: "rgb(212 212 212 / 0.1)"
    textColor: "{colors.bone}"
    typography: "{typography.ui}"
    rounded: "{rounded.nav}"
    padding: "6px 16px"
  nav-frosted:
    backgroundColor: "rgb(212 212 212 / 0.1)"
    rounded: "{rounded.nav}"
    padding: "6px"
  nav-solid:
    backgroundColor: "rgb(22 22 22 / 0.9)"
    rounded: "{rounded.nav}"
    padding: "6px"
  card-glass:
    backgroundColor: "rgb(212 212 212 / 0.1)"
    rounded: "{rounded.card}"
    padding: "16px"
  card-surface:
    backgroundColor: "rgb(255 255 255 / 0.04)"
    textColor: "{colors.bone}"
    rounded: "{rounded.card}"
    padding: "20px"
  panel-summary:
    backgroundColor: "rgb(255 255 255 / 0.04)"
    rounded: "{rounded.large}"
    padding: "32px"
  alert-friction:
    backgroundColor: "rgb(255 255 255 / 0.03)"
    textColor: "{colors.bone}"
    rounded: "{rounded.ui}"
    padding: "10px 12px"
---

# Design System: Friction control room

## Overview

**Creative North Star: "The Dusk-Lit Control Room"**

A dark workspace at the moment the sun goes down. The canvas is void; white and warm greys do all the talking; the only colour in the world is the horizon's, amber on the left burning through to cobalt on the right. That light owns the landing hero, and everywhere else it survives only as meaning: a finding glows hot coral when it blocks a user and cools toward cobalt as it gets cosmetic. Three users' struggles surface as warm light on a dark canvas. The confirmed anti-reference is the grey, light admin dashboard: no pale backgrounds, no grey card grids.

The world was pinned by the user from a "Dimension" style reference: a dusk-lit dark workspace built from frosted glass at 10%, 1px hairlines, pill-shaped controls, DM Sans at weight 500 for display and body, Geist for headings, Geist Mono for data, an amber-to-cobalt hero gradient, and violet that exists only as a wash or a glow. Depth is light passing through glass, never a card lifted on a shadow.

Density splits by surface. The landing hero is generous and cinematic (a 72px headline, a device frame rising off the bottom edge replaying a real run). The control room and report are dense instruments read from across a room: 13 to 14px labels, tabular numbers, mono for anything measured, a status light on everything that has a state. Motion is small and informative: new evidence steps in, a running persona breathes, a violet band sweeps while a persona thinks, and all of it stops under reduced motion.

**Key Characteristics:**
- Void canvas (#0a0a0a) with a dark colour scheme declared at the document level.
- Frosted glass (10% frost, 4px backdrop blur) and 1px white-alpha hairlines instead of fills and shadows.
- Pills for every control; a single filled style, the white pill.
- DM Sans 500 speaks, Geist names things, Geist Mono measures.
- One gradient (the horizon), one accent light (violet), one meaning for every other hue (severity).
- Fonts and icons are bundled; the app renders with the wifi off.

## Colors

A monochrome dusk: white and warm greys on void, with a five-step severity spectrum sampled from the hero horizon and a single violet used only as light.

### Primary
- **Lamp White** (#ffffff): the lit surface of the system. Fills the one filled button style (the white pill), sets headlines, persona names and current-action text, marks a succeeded persona as a plain white dot, and draws the 2px focus ring. As an alpha it builds every tonal layer (3%, 4%, 8%, 10%, 12%).

### Secondary: the severity spectrum
Sampled from the horizon, hot to cool. Severity is the only reason these hues appear.
- **Sunset Coral** (#ff6b57, S5 Blocker): blocker findings, the failed persona state, form errors, the live-session dot, the friction count when it is above zero.
- **Ember Amber** (#ff9e4f, S4 Major): major findings, the timed-out and warning states (fixture streams, reconnecting), steps slower than five seconds, and the step-cap bar once a persona passes 12 of 15 steps.
- **Last-Light Gold** (#f5cf7a, S3 Moderate): moderate findings.
- **Twilight Periwinkle** (#a29dff, S2 Minor): minor findings.
- **Night Cobalt** (#7894ff, S1 Cosmetic): cosmetic findings.

Each severity hue is used as text, as a 6px dot, as a solid bounding-box border on evidence, as an 8px spectrum bar, and as a 45%-alpha badge outline. All five exceed 6.4:1 on void and on the card surface.

### Tertiary
- **Dusk Violet** (#6b62f2): light, never paint. It appears only as the sweeping wash band (56% at its centre), the radial spotlight behind the report's headline number (42% fading to 12%), and the running glow dot (white core through #b9b3ff to violet at 90%). It measures 4.4:1 on void and is never used for text or a solid shape.

### Neutral
- **Void** (#0a0a0a): the canvas, the device screen inside the hero preview, and the dark base for translucent fills: fields (42%, 60% on focus), ghost pills on the horizon (35% to 45%), overlay labels on screenshots (70%), and the evidence dimming mask (42%).
- **Graphite** (#161616): the text colour on the white pill, screenshot placeholders, and the floating nav once it leaves the hero (90%).
- **Frost** (#d4d4d4): the glass tint, used only at 10% (run form, status pill, frosted nav, replay strip). Never solid.
- **Bone** (#ededed): default body text, the white pill's hover fill, progress and confidence fills, the scrubber's played track.
- **Ash** (#c2c2c2): secondary text: ledes, persona rationale, descriptions, placeholders, the "why it matters" line. 11.1:1 on void.
- **Smoke** (#b2b2b2): the quietest text allowed: meta, counts, timestamps, URLs, tags, empty states. 9.3:1 on void.
- **Slate** (#686868): the idle status dot and nothing else. 3.6:1 on void.
- **Hairline** (#e5e5e5): 1px borders and rules, almost always at an alpha (see Shapes); full strength only for a focused field or a selected ghost pill.
- **Ink** (#000000): glyphs on the white persona tiles and the logo mark.

### The horizon
The landing hero's background is a five-stop horizontal gradient, the sun going down on the left and night arriving on the right: #f29a45 at 0%, #ea6a43 at 22%, #bf4a78 at 47%, #6b52dc at 72%, #2447d4 at 100%. A vertical scrim of void (90% at the top, 62% at 38%, 8% at 78%, clear at the bottom) lets night fall from the top of the sky so the white headline always sits on dark. These stops are gradient-only; they are not colour tokens.

### Named Rules
**The Horizon Owns the Hero Rule.** The amber-to-cobalt gradient paints the landing hero and nothing else. Every other surface sits on void.

**The Sampled Severity Rule.** Every hue outside white and grey is sampled from the horizon and means severity, S5 hot coral down to S1 cool cobalt. Persona states reuse the same lights: running is the violet glow dot, succeeded is white, failed is coral, timed out is amber, idle is slate. No new hues.

**The Violet Is Light Rule.** Violet appears only as a wash, a spotlight, or a glow. Never a solid violet dot, fill, border or word.

**The Slate Floor Rule.** Slate is 3.6:1 on void: dots and rules only, never text. The quietest text is smoke.

**The Reset Palette Rule.** Tailwind's default palette is reset (`--color-*: initial`); only the tokens above exist as colour utilities. White-alpha layers are expressed as alphas of those tokens, not as new greys.

## Typography

**Display Font:** DM Sans Variable (optical sizing on; falls back to ui-sans-serif, system-ui)
**Heading Font:** Geist Variable (falls back to ui-sans-serif, system-ui)
**Data Font:** Geist Mono Variable (falls back to ui-monospace, SF Mono, Menlo, Consolas)

**Character:** DM Sans at a single weight, 500, carries display, body and controls with a slightly open 0.025em tracking, soft and humane at large sizes. Geist gives section and item headings a tighter, more engineered voice. Geist Mono is the instrument readout.

### Hierarchy
- **Display** (DM Sans 500, 72px, line-height 1, -0.035em): the hero headline, fluid at `clamp(44px, 6.2vw, 72px)` with 1.02 leading and broken into two lines at 1024px and up (21ch measure below); the report's headline finding count.
- **Headline** (Geist 600, 32px, line-height 1.25, -0.025em): section heads ("Recent runs", "Findings", the how-it-works lede, which lifts to 36px at 640px and up).
- **Title** (Geist 500, 24px, line-height 1.33, -0.02em): the run's task in the run bar, finding titles, and the "01" finding rank in ash.
- **Subheading** (DM Sans 500, 18px, 1.5): ledes (46ch), accordion summaries, finding summaries (65ch), the report count's label.
- **Body** (DM Sans 500, 16px, 1.5): persona rows, current action, recommendations, run tasks; detail copy capped at 60 to 65ch.
- **Control** (DM Sans 500, 15px): the white pill, fields, the nav wordmark.
- **UI** (DM Sans 500, 14px, 1.5): ghost pills, nav tabs, status pill, rationale lines, alert summaries.
- **Caption** (DM Sans 500, 13px, 1.5, 0.33px): tags, badges, pane titles, timeline rows, meta. The smallest system size.
- **Mono** (Geist Mono 500, 13px, tracking normal, tabular): URLs, run ids, selectors, the run clock (32px, -0.02em, white).

### Named Rules
**The Three Voices Rule.** DM Sans speaks (display, body, controls), Geist names (headings), Geist Mono measures (URLs, ids, selectors, clocks). A string that is copied, compared or timed is mono.

**The Tabular Numbers Rule.** Every count, duration, step number, percentage and clock is set with tabular figures, so live numbers never jitter.

**The One Weight Rule.** DM Sans runs at 500 everywhere; hierarchy comes from size, colour (white, bone, ash, smoke) and family, not from bolding. Emphasis inside a line is a colour step up ("Heads up." in white, "Fix:" in bone), and rationale is italic ash in curly quotes.

**The Bundled Type Rule.** All three families ship through `@fontsource-variable`; the app must render with the wifi off. No CDN font links.

## Layout

The app is a full-height flex column under a floating nav. Content sits in a centred container capped at 1200px with a 16px gutter (24px from 640px). The nav floats 16px from the top of the viewport, so content clears it: 96px on the landing hero, 80px on run views, 96px scroll margin on anchored sections.

**Landing.** The hero is full-bleed horizon with 42px bottom corners. The live status pill is centred, the headline runs across the top, and below it a two-column grid (from 1024px, 56px gap) aligns to the bottom edge: persona rows and the frosted run form on the left, the device frame on the right rising out of the hero's bottom edge. Below 1024px everything stacks in the same order. Further sections use a 5:7 split with a sticky heading on the left (from 1024px), then a full-width list card.

**Control room.** Three equal persona columns (16px gap) from 1024px; each fills the remaining viewport height and scrolls its own friction-and-timeline pane with contained overscroll. Below 1024px the columns stack and the page scrolls. On screens 860px tall or less at desktop width, the screenshot shrinks to 25vh (keeping 16:9) so the friction pane stays in view.

**Report.** The same 1200px container: a summary panel, then a findings list where each card pairs a screenshot column (up to 480px) with the text column from 1024px, stacking below.

**Rhythm.** A 4px base: 4 to 12px inside controls and rows, 16 to 24px between cards and card padding, 32 to 56px between hero blocks, 64 to 96px between page sections. Breakpoints reveal detail rather than restructure: nav links appear at 768px, multi-column layouts at 1024px, step counters, relative timestamps and connection labels at 1536px.

## Elevation & Depth

Depth is light, not lift. Surfaces are flat and separated by three means: frosted glass (10% frost with a 4px backdrop blur) over whatever is behind it; tonal white-alpha layers on void (3% for alerts and row hovers, 4% for cards and columns, 8% for a selected pill, 10% for the device frame, 12% for active counters and speed chips); and 1px hairlines. The warmest depth cue is literal light: the horizon behind the hero's glass, the violet spotlight behind the report number, the glow on a running dot. Legibility over the horizon comes from a dusk pool, a blurred shape of void at 45% (28px blur, 42px corners) that travels with the run form at every breakpoint and holds the hero form cluster at 5.4:1 or better.

### Shadow Vocabulary
- **Inset hairline** (`box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1)`): a second, inner edge on the glass run form. It reads as a border, not a shadow.
- **Nav whisper** (`box-shadow: 0 3px 4.5px rgb(255 255 255 / 0.02), 0 10px 8px rgb(0 0 0 / 0.04), 0 4px 3px rgb(0 0 0 / 0.1)`): the floating nav only, the one element that genuinely floats over scrolling content.
- **Evidence mask** (`box-shadow: 0 0 0 9999px rgba(10, 10, 10, 0.42)`): not elevation. It dims everything on a screenshot outside the target's bounding box.

### Named Rules
**The Light, Not Lift Rule.** No card, panel or popover is raised on a drop shadow. Separate with glass, a white-alpha step or a hairline; the nav's whisper is the only exterior shadow in the system.

## Shapes

Corners track containment: the bigger and more outer the object, the rounder it is.

- **Panel** (42px): the hero's bottom corners and the dusk pool.
- **Large** (40px): the report summary panel and the device frame's top corners (its inner screen steps in to 32px, concentric at 8px inset).
- **Card** (24px): persona columns, finding cards, the recent-runs list, the run form.
- **Nav** (19px): the floating nav, the status pill and the fallback notice.
- **UI** (10px): tags, friction alerts, timeline rows, recommendation boxes, finished-state summaries.
- **Icon** (4px): the white persona glyph tiles.
- **Pill** (fully rounded): every button, field, state and severity badge, the replay strip, overlay labels, progress tracks and dots.
- Screenshots nested inside cards sit in 12 to 16px frames; the evidence bounding box is a 2px border with 3px corners.

Borders are always 1px (2px only for the evidence box) and almost always a hairline alpha: 10% for card edges and dividers, 15% for glass, the nav and badges, 20% for the status pill and tags, 22% for fields at rest (40% on hover), 28% for ghost pills at rest (70% on hover), full strength for focus and selection. On the horizon, borders switch to white at 20 to 40%. Severity badges draw their outline in the severity hue at 45%. Progress lines are 2px, the severity spectrum bars 8px, status dots 6 to 8px.

Icons are a small hand-drawn set on a 20px grid: 1.5px stroke, round caps and joins, `currentColor`, decorative unless labelled. Persona glyphs (bolt, eye, keys) sit black on 20 to 24px white tiles. The logo mark is a white rounded square (8px on 28) carrying three black strokes, the middle one hitting something.

### Named Rules
**The Tag Is Not a Button Rule.** The tag is the label shape: action verbs, data-source and run-status chips, persona names on findings. Its 10px corner is deliberately not a pill, so a label never reads as pressable. Controls are full pills; persona-state and severity badges are pills too, marked as readouts by their leading light.

## Components

### Buttons
Soft, confident pills; one filled style.
- **Shape:** fully rounded (9999px), content centred with a 6px icon gap.
- **Primary (white pill):** white fill, graphite text, 15px, 40px tall with 18px side padding. In the nav it compacts to 34px tall, 16px padding, 14px text. Used for the run's main verb: Start run, Watch the demo, New run, Play/Pause.
- **Hover / Active / Disabled:** hover fills bone; press scales to 0.98 on the expo ease; disabled drops to 35% opacity with a not-allowed cursor. Transitions run 160ms ease-out.
- **Ghost pill:** transparent with a 28% hairline border and 85% white text, 34px tall, 14px padding. Hover lifts the border to 70% and the text to white. Selected (`aria-current` or `aria-pressed`) takes a full hairline border and an 8% white fill; used for nav tabs, persona filters and suggested tasks. Nav links and inactive tabs drop the border entirely (inactive tab text at 70% white). Disabled shows a wait cursor at 55%.
- **Ghost on the horizon:** white text, 40% white border and a 45% void fill, 32px tall, so it holds contrast over any part of the gradient.
- **Focus:** a 2px white outline at 2px offset on every interactive element.

### Chips, Tags and Badges
- **Tag:** 1px hairline at 20%, smoke caption text, 10px corners, 2px by 8px padding. Carries action verbs, persona names and, with a 6px status light in front, data-source and run-status chips (Replay, Fixture stream, Offline fixture, Live, Golden run).
- **State badge:** a 28px pill with a 15% hairline, bone caption text and an 8px status light: Idle (slate), Running (violet glow dot, breathing), Succeeded (white), Failed (coral), Timed out (amber).
- **Severity badge:** a 24px pill outlined in the severity hue at 45%, a 6px dot and "S5" in the hue, optionally followed by the label in bone.
- **Count badge:** a 20px pill of 12% white holding a tabular count, inside the Report tab.

### Status Lights
The system's smallest signature: 6 to 8px circles. Idle is slate, succeeded white, warning amber, failure coral. Running is never a flat violet dot: it is a radial glow (white core, pale violet, violet edge fading out) that breathes (opacity 1 to 0.55, scale 1 to 0.8, 1.6s ease-in-out). Connecting and reconnecting lights breathe too.

### Cards / Containers
- **Corner Style:** 24px for cards, 40px for the summary panel, 10px for alerts and rows inside them.
- **Background:** 4% white on void for cards and columns; 3% for friction alerts, finished summaries and row hovers; 10% frost for glass.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px hairline at 10% (15% for glass).
- **Internal Padding:** 20px in persona columns, 20px in list rows (24px from 640px), 20 to 28px in finding text columns, 24 to 32px in the summary panel, 12px around nested screenshots.
- **Recent-runs card:** a 1px violet wash, frozen at its centre, lights the card's top edge.

### Inputs / Fields
- **Style:** a 46px pill, 22% hairline border, 42% void fill, white 15px text, ash placeholder, 18px side padding. The URL field is set in Geist Mono at 14px.
- **Hover:** border to 40%.
- **Focus:** alongside the global white focus ring, the border goes to full hairline and the fill deepens to 60% void (160ms); the caret is white.
- **Error:** the message sits beneath the form in coral caption text with `role="alert"`, and focus moves to the offending field.

### Navigation
- **Style:** a detached bar floating 16px from the top, centred, with 19px corners, 6px padding and 4px gaps. Over the hero it is frosted (10% frost, 20% white border, 4px blur); once the hero scrolls away it turns to 90% graphite with a 15% hairline (300ms ease-out) so text cannot bleed through.
- **Contents:** the logo mark and white 15px "Friction" wordmark (home), then links or tabs as ghost pills, then one white pill as the action.
- **Landing:** "How it works" and "Recent runs" links (hidden below 768px) and a "Watch the demo" white pill.
- **Run views:** "Control room" and "Report" tabs (the report tab carries a count badge) and a white "New run" pill. The run form never appears here.
- **Mobile:** on run views the wordmark becomes screen-reader-only, the tab shortens to "Room", and "New run" collapses to its plus icon.

### Horizon Hero (signature)
The full-bleed horizon with its night scrim and 42px bottom corners. A glass status pill (19px corners, 20% hairline) reports what the demo machine can reach, each service with its own status light. The 72px headline, three persona rows (white glyph tile, white name, bone line at 80%), then the frosted run form on its dusk pool: URL and task fields, a ghost "Suggest tasks" pill on 35% void, and the white "Start run" pill.

### Device Preview (signature)
A device frame rising out of the hero's bottom edge: 40px top corners, no bottom border, 25% white border, 10% white glass with 4px blur, 8px inset. Inside, a 32px-cornered void screen replays the bundled golden run: a chip, a mono URL pill, a mono clock, the task, and three 16px-cornered lanes, each with a status light, the latest screenshot, the current verb and up to two friction lines in their severity hue. It advances one event every 520ms (900ms lead-in, 5.2s hold at the end), pauses off-screen, and shows the final frame under reduced motion.

### Persona Column (signature)
A 24px card per persona: a white glyph tile, name and state badge; a 2px step-cap bar (bone, turning amber after 12 of 15 steps, width eased over 700ms); the live view or latest screenshot in a 12px frame with a pill overlay label ("Live" with a coral breathing dot, "Latest", "Final") on 70% void glass. Then the current action: a verb tag, the target in white, and the persona's rationale in italic ash. While running, a 2px violet wash sweeps beneath it; when finished, a 3% summary box with the state light replaces it. One scroll pane follows, friction first (sorted by severity, the count in coral when non-zero), then the timeline (caption rows: number, verb, target, severity badge, duration in amber past five seconds).

### Evidence Image
A screenshot at its viewport's aspect ratio on a graphite placeholder, with the target boxed by a 2px border (the severity hue in the report, white elsewhere) and everything outside the box dimmed to 42% void. When pixels are unavailable it renders the step as a local wireframe, and otherwise says "Screenshot unavailable" in smoke.

### Severity Spectrum
The report's findings laid out hot to cool like the horizon they came from: one 8px pill bar per severity present, its width proportional to its count (at least 104px), 4px apart, each labelled beneath with a white title-size count and the severity name in its hue.

### Replay Strip and Scrubber
A glass pill (15% hairline, 4px padding, 480px wide from 640px) holding a white Play/Pause pill, a circular ghost restart, the scrubber, a mono position counter, and a segmented speed control (selected speed on 12% white, others smoke). The scrubber is a 2px track (bone played, 18% hairline remaining) with a 14px white thumb and a 20px hit height.

### Motion
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` (expo out) for arrivals and presses; 160ms ease-out for colour and border changes.
- **Step in** (420ms, expo): new steps, actions and friction alerts arrive from 6px above, from 0 opacity and a 3px blur.
- **Breathe** (1.6s, infinite): running and connecting status lights.
- **Wash sweep** (1.8s, `cubic-bezier(0.45, 0, 0.25, 1)`, infinite): the violet band crossing a 1 to 2px track while a persona thinks or the report builds.
- **Reduced motion:** step-in, breathe and the sweep stop; the wash freezes at its centre; smooth scrolling turns off; the device preview shows its last frame.

## Do's and Don'ts

### Do:
- **Do** keep the canvas void (#0a0a0a) and let white and the warm greys carry hierarchy: white for what matters, bone for body, ash for secondary, smoke for meta.
- **Do** take every state or severity colour from the existing tokens: S5 coral through S1 cobalt; running is the violet glow dot, succeeded white, failed coral, timed out amber, idle slate.
- **Do** make every new control a pill, and use the white pill for the primary verb of its region.
- **Do** separate surfaces with 10% frosted glass, a white-alpha step (3% to 12%) or a 1px hairline.
- **Do** put a dusk pool behind any text cluster that sits on the horizon, holding at least 4.5:1 (the hero form cluster measures 5.4:1 or better).
- **Do** set URLs, ids, selectors and clocks in Geist Mono with normal tracking, and every number in tabular figures.
- **Do** write labels in sentence case and keep DM Sans at weight 500.
- **Do** keep the 2px white focus ring (2px offset) visible on every interactive element, and make every animation stop under reduced motion.
- **Do** label where the data on screen comes from (Live, Replay, Fixture stream, Offline fixture) with a status-light chip.

### Don't:
- **Don't** build the grey, light admin dashboard: no light backgrounds, no grey card grids.
- **Don't** introduce a hue outside the horizon. The Tailwind palette is reset; don't bring colours back through arbitrary values.
- **Don't** use the horizon gradient anywhere but the landing hero.
- **Don't** fill, border or write in violet, and never draw a solid violet dot; violet is only a wash, a spotlight or a glow.
- **Don't** set text in slate (#686868, 3.6:1 on void); it is for dots and rules only.
- **Don't** raise cards or panels on drop shadows; the nav's whisper is the only exterior shadow.
- **Don't** add a second filled button colour; white is the only filled style.
- **Don't** add CDN font, icon or image links; fonts are bundled via `@fontsource-variable` and the app must render with the wifi off.
- **Don't** place the run form outside the landing hero; run views get the floating nav with tabs and a white "New run" pill.
