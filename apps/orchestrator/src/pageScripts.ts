/**
 * JavaScript that runs INSIDE the remote page.
 *
 * These are strings on purpose. tsx compiles with esbuild's keepNames, which
 * wraps functions in a __name() helper that does not exist in the page, so a
 * TypeScript function handed to page.evaluate() can throw "__name is not
 * defined". Plain strings are immune. They are exercised for real by
 * scripts/smoke-local.ts.
 *
 * Shared helpers live on window.__fr so each script stays small.
 */

const HELPERS = `
(() => {
  const w = window;
  if (w.__fr && w.__fr.v === 5) return;
  const clean = (s) => String(s || "").replace(/\\s+/g, " ").trim().slice(0, 90);
  const visible = (el) => {
    if (!el || !el.getClientRects || el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  };
  const labelOf = (el) => {
    if (!el || el === document.body || el === document.documentElement) return "";
    const aria = el.getAttribute("aria-label");
    if (aria && clean(aria)) return clean(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = clean(by.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || "").join(" "));
      if (t) return t;
    }
    if (el.id) {
      try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && clean(l.textContent)) return clean(l.textContent); } catch (e) {}
    }
    const wrap = el.closest && el.closest("label");
    if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
    return clean(el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder") || el.innerText || el.value || el.getAttribute("name") || el.id || el.tagName.toLowerCase());
  };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  let counter = 0;
  const keyOf = (el) => { if (!el || el === document.body || el === document.documentElement) return "body"; if (!el.__frid) el.__frid = ++counter; return "el" + el.__frid; };
  const byXPath = (xp) => { try { return document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch (e) { return null; } };

  // Text- or media-bearing nodes only: a ripple <span> or a spinner is not "the page responded".
  const meaningfulNode = (n) => {
    if (n.nodeType === 3) return clean(n.textContent).length > 0;
    if (n.nodeType !== 1) return false;
    if (clean(n.textContent).length > 0) return true;
    return !!(n.matches && (n.matches("img,video,canvas,svg,iframe,input,select,textarea,button,a") || n.querySelector("img,video,canvas,iframe,input,select,textarea,button,a")));
  };
  const near = (n) => { const out = []; let e = n.nodeType === 1 ? n : n.parentElement; for (let i = 0; e && i < 2; i++, e = e.parentElement) out.push(e); return out; };
  // MutationObserver cannot see property changes. Ticking a radio, choosing an option or typing
  // is the page responding, so fingerprint the form state and compare it across the action.
  const formState = () => { let out = ""; const els = document.querySelectorAll("input, select, textarea"); for (let i = 0; i < els.length && i < 400; i++) { const e = els[i]; out += (e.type === "checkbox" || e.type === "radio" ? (e.checked ? "1" : "0") : String(e.value).length + ":" + String(e.value).slice(0, 24)) + "|"; } return out; };
  // A dialog, or a large fixed layer that is not the app shell (a shell holds most of the page's controls; a popup holds few).
  const findOverlay = () => {
    for (const el of document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) { if (visible(el)) return el; }
    const vw = innerWidth, vh = innerHeight; const controls = document.querySelectorAll("a[href], button").length || 1;
    let el = document.elementFromPoint(vw / 2, vh / 2);
    while (el && el !== document.body && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && (parseInt(cs.zIndex, 10) || 0) > 0) {
        const r = el.getBoundingClientRect();
        if (r.width * r.height >= 0.2 * vw * vh && el.querySelectorAll("a[href], button").length / controls < 0.5) return el;
      }
      el = el.parentElement;
    }
    return null;
  };
  const st = { v: 5, clean, visible, labelOf, rectOf, keyOf, byXPath, formState, findOverlay, formBefore: "", targets: [], phase: "ambient", ambient: new WeakSet(), meaningful: 0, lastMutation: 0 };
  st.observer = new MutationObserver((records) => {
    for (const r of records) {
      // Whatever mutates while nobody is acting (carousels, timers, ads) is ambient noise.
      if (st.phase === "ambient") { for (const e of near(r.target)) st.ambient.add(e); continue; }
      if (near(r.target).some((e) => st.ambient.has(e))) continue;
      let hit = false;
      if (r.type === "childList") { r.addedNodes.forEach((n) => { if (meaningfulNode(n)) hit = true; }); r.removedNodes.forEach((n) => { if (meaningfulNode(n)) hit = true; }); }
      else hit = true;
      if (hit) { st.meaningful += 1; st.lastMutation = Date.now(); if (st.targets.length < 300) st.targets.push(r.target.nodeType === 1 ? r.target : r.target.parentElement); }
    }
  });
  st.observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["aria-expanded", "aria-hidden", "aria-selected", "aria-checked", "aria-pressed", "aria-invalid", "aria-busy", "aria-current", "open", "hidden", "disabled", "checked", "value", "src", "href", "data-state"],
  });
  w.__fr = st;
})();
`;

/** Install the helpers and start treating mutations as ambient noise. Call at observe time. */
export const ARM_AMBIENT = `${HELPERS} window.__fr.phase = "ambient"; true`;

/** Call immediately before acting: from here on, mutations count as the page responding. */
export const ARM_ACTION = `${HELPERS} window.__fr.phase = "action"; window.__fr.meaningful = 0; window.__fr.lastMutation = 0; window.__fr.formBefore = window.__fr.formState(); window.__fr.targets = []; true`;

/**
 * After acting. `armed: false` means the page was replaced (navigation), which
 * is itself a change. quietMs lets the caller wait for the DOM to settle.
 */
export const READ_MUTATIONS = `(() => { const st = window.__fr; if (!st || st.phase !== "action") return { armed: false, meaningful: 0, outsideOverlay: 0, formChanged: false, quietMs: 99999 }; const ov = st.findOverlay(); const outside = st.targets.filter((t) => t && !(ov && (ov === t || ov.contains(t)))).length; return { armed: true, meaningful: st.meaningful, outsideOverlay: outside, formChanged: st.formState() !== st.formBefore, quietMs: st.lastMutation ? Date.now() - st.lastMutation : 99999 }; })()`;

export interface PageState {
  url: string;
  title: string;
  viewport: { w: number; h: number };
  scrollX: number;
  scrollY: number;
  scrollMax: number;
  focus: { key: string; label: string; tag: string; bbox: { x: number; y: number; w: number; h: number } | null };
  /** A dialog or large fixed overlay covering the page, if any. */
  overlay: { label: string } | null;
  /** The next keyboard stops after the current focus, in tab order. */
  tabStops: string[];
}

export const PAGE_STATE = `${HELPERS} (() => {
  const st = window.__fr; const vw = innerWidth, vh = innerHeight;
  const active = document.activeElement;
  const focus = { key: st.keyOf(active), label: st.labelOf(active), tag: active ? active.tagName.toLowerCase() : "body", bbox: active && active !== document.body ? st.rectOf(active) : null };

  const overlayEl = st.findOverlay();
  let overlay = null;
  if (overlayEl) {
    const heading = overlayEl.querySelector("h1, h2, h3, [role=heading]");
    overlay = { label: st.clean(overlayEl.getAttribute("aria-label") || (heading && heading.textContent) || overlayEl.innerText).slice(0, 70) || "overlay" };
  }

  const stops = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]')]
    .filter((el) => !el.disabled && el.tabIndex >= 0 && st.visible(el));
  const at = stops.indexOf(active);
  const tabStops = stops.slice(at + 1, at + 13).map((el) => (el.getAttribute("role") || el.tagName.toLowerCase()) + ' "' + st.labelOf(el) + '"');

  return {
    url: location.href, title: document.title, viewport: { w: vw, h: vh },
    scrollX: Math.round(scrollX), scrollY: Math.round(scrollY), scrollMax: Math.max(0, Math.round(document.documentElement.scrollHeight - vh)),
    focus, overlay, tabStops,
  };
})()`;

export interface FocusProbe {
  key: string;
  label: string;
  bbox: { x: number; y: number; w: number; h: number } | null;
  url: string;
}

/** Cheap: called before and after every single key press. */
export const FOCUS_PROBE = `${HELPERS} (() => { const st = window.__fr; const a = document.activeElement; return { key: st.keyOf(a), label: st.labelOf(a), bbox: a && a !== document.body ? st.rectOf(a) : null, url: location.href }; })()`;

export interface Located {
  found: boolean;
  label: string;
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** True if the element had to be scrolled into view, so the evidence screenshot must be retaken. */
  scrolled: boolean;
  /** The element declares that it opens something (aria-haspopup / aria-controls / aria-expanded / <summary>). */
  opensPopup: boolean;
}

/** Find a target by XPath, bring it into the viewport, and measure it. */
export function locateScript(xpath: string): string {
  return `${HELPERS} (() => {
    const st = window.__fr; const el = st.byXPath(${JSON.stringify(xpath)});
    if (!el || el.nodeType !== 1) return { found: false, label: "", bbox: null, scrolled: false, opensPopup: false };
    let r = el.getBoundingClientRect(); let scrolled = false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) { el.scrollIntoView({ block: "center", inline: "center" }); scrolled = true; r = el.getBoundingClientRect(); }
    const opensPopup = el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-controls") || el.hasAttribute("aria-expanded") || el.tagName === "SUMMARY";
    return { found: true, label: st.labelOf(el), bbox: r.width > 0 && r.height > 0 ? st.rectOf(el) : null, scrolled, opensPopup };
  })()`;
}

/**
 * hrefs a visitor reaches from the site's navigation: anchors inside nav,
 * header and [role=navigation] (collapsed dropdown items included), followed
 * by every visible anchor on the page, so a header with only a logo or a
 * sign-in link still leaves slots to fill. Only real HTML anchors: an SVG
 * <a> exposes `href` as an SVGAnimatedString, not a string. Filtering (same
 * origin, auth pages, files, duplicates, the 5-link cap) is pickCrawlLinks'
 * job, in Node.
 */
export const NAV_LINKS = `(() => {
  const hrefs = (root, visibleOnly) => Array.from(root.querySelectorAll("a[href]"))
    .filter((a) => a instanceof HTMLAnchorElement && (!visibleOnly || a.getBoundingClientRect().width > 0))
    .map((a) => a.href);
  const scoped = Array.from(document.querySelectorAll("nav, header, [role=navigation]")).flatMap((el) => hrefs(el, false));
  return [...scoped, ...hrefs(document, true)];
})()`;

/** The real markup a fix is written against: the step's target, and any overlay covering the page. "" when there is none. */
export interface ElementHtml {
  target: string;
  overlay: string;
}

/**
 * An element as its opening-tag ancestors (up to four) and its own outerHTML,
 * cut to a length a prompt can carry. The accessibility tree says what a
 * visitor perceives; this says what a selector can hold on to.
 */
export function elementHtmlScript(xpath: string | null): string {
  return `${HELPERS} (() => {
    const st = window.__fr;
    // No regular expressions and no "\\n" literals in here: this is a template literal, which would eat their backslashes.
    const open = (el) => { const html = el.cloneNode(false).outerHTML; const close = html.lastIndexOf("</"); return close > 0 ? html.slice(0, close) : html; };
    const show = (el, max) => {
      if (!el || el.nodeType !== 1) return "";
      const chain = [];
      for (let p = el.parentElement; p && p !== document.documentElement && chain.length < 4; p = p.parentElement) chain.unshift(open(p));
      const html = el.outerHTML.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean).join(" ");
      return chain.concat(html.length > max ? html.slice(0, max) + " ..." : html).join(String.fromCharCode(10));
    };
    return { target: show(${xpath ? `st.byXPath(${JSON.stringify(xpath)})` : "null"}, 1200), overlay: show(st.findOverlay(), 1800) };
  })()`;
}
