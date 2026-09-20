/**
 * Everything the overlay looks like, in one string.
 *
 * Injected via a <style> element into the shadow root render.ts creates --
 * never into document.head. No selector needs a host-page-safe prefix
 * because the shadow boundary already isolates it in both directions: the
 * host page's stylesheets cannot reach in here, and these rules cannot leak
 * out onto the host page.
 *
 * Tokens are taken from apps/control-room/DESIGN.md (the control room's
 * design system) so a finding reads the same hue here as it does there --
 * same severity ramp (sev-1..sev-5), same void/graphite/bone/ash/smoke
 * neutrals, same pill/card radii. Two deliberate departures from that doc,
 * both load-bearing for a bookmarklet:
 *  - No webfonts. DESIGN.md's DM Sans/Geist are bundled into the control
 *    room via @fontsource; this overlay ships as a javascript: URL with zero
 *    runtime dependencies, so fetching a font from someone else's site is
 *    both a CSP hazard and a privacy leak. The declared stacks are kept with
 *    the named families dropped, resolving to their system fallbacks.
 *  - The panel and cards keep a solid graphite fill plus DESIGN.md's "nav
 *    whisper" shadow rather than frosted glass: they float over an arbitrary,
 *    uncontrolled host page (not the control room's own void canvas), so a
 *    translucent surface risks vanishing into whatever is behind it. The
 *    whisper shadow is DESIGN.md's own sanctioned exception for the one
 *    element that genuinely floats over scrolling content -- which is
 *    exactly what the panel and an open card do here.
 *
 * Kept deliberately plain otherwise. The whole bundle (this string included,
 * verbatim, since a minifier will not touch text inside a JS string literal)
 * has to clear a 25KB budget alongside the resolver and the renderer.
 */
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer, .panel, .card {
  font: 500 13px/1.5 ${SANS};
  letter-spacing: 0.025em;
  color: #ededed;
}
.layer { position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: visible; }

.marker {
  position: absolute;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  border-radius: 9999px;
  z-index: 2147483000;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 11px;
  color: #0a0a0a;
  cursor: pointer;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8), 0 1px 4px rgba(0, 0, 0, 0.45);
}
.marker--exact { border: 2px solid #0a0a0a; }
.marker--likely { border: 2px dashed #0a0a0a; }
.marker--guess { border: 2px dotted #0a0a0a; opacity: 0.7; }
.marker:focus-visible, .row:focus-visible, .close:focus-visible, .panel-toggle:focus-visible, .panel-section a:focus-visible {
  outline: 2px solid #fff; outline-offset: 2px;
}

.sev-1 { background: #7894ff; }
.sev-2 { background: #a29dff; }
.sev-3 { background: #f5cf7a; }
.sev-4 { background: #ff9e4f; }
.sev-5 { background: #ff6b57; }

.card {
  position: absolute;
  max-width: 340px;
  background: #161616;
  border: 1px solid rgba(229, 229, 229, 0.15);
  border-radius: 24px;
  box-shadow: 0 3px 4.5px rgba(255, 255, 255, 0.02), 0 10px 8px rgba(0, 0, 0, 0.15), 0 4px 3px rgba(0, 0, 0, 0.35);
  padding: 16px 18px;
  z-index: 2147483002;
}
.card[hidden] { display: none; }
.card-head { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
.card-head strong { flex: 1; font-size: 13px; font-weight: 600; color: #fff; }
.card .close {
  border: none; background: transparent; cursor: pointer; font-size: 15px;
  line-height: 1; padding: 2px 6px; color: #c2c2c2; border-radius: 9999px;
}
.card .close:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.card .meta { font-size: 11.5px; letter-spacing: 0.33px; color: #b2b2b2; margin: 0 0 8px; }
.card .hedge {
  font-style: italic; color: #ededed; background: rgba(255, 255, 255, 0.03);
  padding: 8px 10px; border-radius: 10px; margin: 0 0 8px;
}
.card p { margin: 0 0 8px; color: #c2c2c2; }
.card .summary { color: #ededed; }
.card img { max-width: 100%; border-radius: 12px; display: block; margin: 4px 0 8px; }
.card details { margin-top: 4px; }
.card summary { cursor: pointer; font-weight: 600; font-size: 12.5px; color: #ededed; }
.card .patch-label { font-style: italic; color: #b2b2b2; font-size: 11.5px; margin: 6px 0 4px; }
.card pre {
  white-space: pre-wrap; word-break: break-word; background: rgba(255, 255, 255, 0.04);
  padding: 10px; border-radius: 10px; font: 500 11.5px/1.4 ${MONO}; color: #ededed;
  max-height: 160px; overflow: auto; margin: 0;
}

.badge {
  flex: 0 0 auto; width: 18px; height: 18px; border-radius: 9999px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600; color: #0a0a0a;
}

.panel {
  position: fixed; right: 16px; bottom: 16px; width: 320px; max-height: 60vh;
  display: flex; flex-direction: column;
  background: #161616; border: 1px solid rgba(229, 229, 229, 0.1); border-radius: 24px;
  box-shadow: 0 3px 4.5px rgba(255, 255, 255, 0.02), 0 10px 8px rgba(0, 0, 0, 0.15), 0 4px 3px rgba(0, 0, 0, 0.35);
  z-index: 2147483001; overflow: hidden;
}
.panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; font-weight: 600; font-size: 12.5px; color: #fff;
  border-bottom: 1px solid rgba(229, 229, 229, 0.1); flex: 0 0 auto;
}
.panel-toggle {
  border: 1px solid rgba(229, 229, 229, 0.28); background: transparent; color: #ededed;
  border-radius: 9999px; width: 22px; height: 22px; cursor: pointer; font-size: 14px; line-height: 1;
}
.panel-toggle:hover { border-color: rgba(229, 229, 229, 0.7); color: #fff; }
.panel-body { overflow: auto; padding: 10px 12px 16px; }
.panel.collapsed .panel-body { display: none; }
.panel-section { margin-bottom: 12px; }
.panel-section h3 { font-size: 12px; letter-spacing: 0.33px; margin: 4px 0; color: #c2c2c2; font-weight: 600; }
.panel-section h4 { font-size: 11.5px; letter-spacing: 0.33px; margin: 8px 0 4px; color: #ff6b57; font-weight: 600; }
.rows { list-style: none; margin: 0; padding: 0; }
.rows li { margin: 2px 0; }
.row {
  display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left;
  border: none; background: transparent; cursor: pointer; padding: 6px 8px;
  border-radius: 10px; font: inherit; color: #ededed;
}
.row:hover { background: rgba(255, 255, 255, 0.06); }
.rows--unlocated li, .panel-section a {
  display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px;
  border-radius: 10px; color: #ededed; text-decoration: none;
}
.panel-section a:hover { background: rgba(255, 255, 255, 0.06); }
.empty-note { font-size: 12px; color: #b2b2b2; padding: 6px; }
`;
