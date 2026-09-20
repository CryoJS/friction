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

/**
 * Mirrors roleOf() inside the HELPERS template string in
 * apps/orchestrator/src/pageScripts.ts (the capture side). The two are
 * compiled and run at different times on the same element, so they MUST
 * agree line for line: the IMPLICIT_ROLES table and all its entries, the
 * explicit `role` attribute taking the first whitespace-separated token,
 * `<a>` -> "link" only when it has `href` (else "generic"), and the
 * `<input>` branch's checkbox/radio special case returning the type itself.
 * Any divergence here silently desyncs the role recorded at capture from the
 * role computed at resolve, and every tier that compares roles then fails
 * open with no error anywhere.
 */
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

  // Tier 3: same tag + role + name, indexed by the capture-time ordinal. The
  // tag scope MUST match capture (pageScripts.ts counts within
  // document.querySelectorAll(el.tagName)) or the ordinal indexes into a
  // different list and pins the wrong element.
  const sameTag = [...doc.querySelectorAll<Element>(anchor.tag)].filter((el) => roleOf(el) === anchor.role && accessibleName(el) === anchor.name);
  if (sameTag.length > 0) return { el: sameTag[Math.min(anchor.ordinal, sameTag.length - 1)]!, confidence: "likely" };

  // Tier 3b: the element's tag changed since capture. Ordinal is meaningless
  // across tags, so take a cross-tag role+name match ONLY when it is unambiguous.
  const crossTag = [...doc.querySelectorAll<Element>("*")].filter((el) => roleOf(el) === anchor.role && accessibleName(el) === anchor.name);
  if (crossTag.length === 1) return { el: crossTag[0]!, confidence: "likely" };

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
