import { describe, expect, it } from "vitest";
import type { Anchor } from "@friction/shared";
import { resolveAnchor } from "./resolve";

const base: Anchor = {
  xpath: "/html/body/main/form/button",
  tag: "button",
  role: "button",
  name: "Add to cart",
  text: "Add to cart",
  attrs: {},
  ordinal: 0,
  path: "/products/hat",
};

function load(html: string): Document {
  document.documentElement.innerHTML = html;
  return document;
}

describe("resolveAnchor", () => {
  it("tier 1: finds by a stable id and calls it exact", () => {
    const doc = load(`<body><main><form><button id="add-to-cart">Add to cart</button></form></main></body>`);
    const result = resolveAnchor({ ...base, attrs: { id: "add-to-cart" } }, doc);
    expect(result.confidence).toBe("exact");
    expect((result.el as HTMLElement).id).toBe("add-to-cart");
  });

  it("tier 1: finds by data-testid even when the tree moved", () => {
    const doc = load(`<body><div><section><button data-testid="buy">Buy now</button></section></div></body>`);
    const result = resolveAnchor({ ...base, name: "Buy now", text: "Buy now", attrs: { "data-testid": "buy" } }, doc);
    expect(result.confidence).toBe("exact");
  });

  it("tier 2: uses the XPath when role and name still match", () => {
    const doc = load(`<body><main><form><button>Add to cart</button></form></main></body>`);
    expect(resolveAnchor(base, doc).confidence).toBe("exact");
  });

  it("tier 2: REJECTS an XPath that now points at a different element", () => {
    const doc = load(`<body><main><form><button>Subscribe</button></form></main></body>`);
    const result = resolveAnchor(base, doc);
    // Must not pin "Add to cart" onto the Subscribe button.
    expect(result.el).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it("tier 3: falls through to role + name, picking the ordinal-th match", () => {
    const doc = load(`<body><ul>
      <li><button>Add to cart</button></li>
      <li><button>Add to cart</button></li>
      <li><button>Add to cart</button></li>
    </ul></body>`);
    const result = resolveAnchor({ ...base, ordinal: 2 }, doc);
    expect(result.confidence).toBe("likely");
    expect([...doc.querySelectorAll("button")].indexOf(result.el as HTMLButtonElement)).toBe(2);
  });

  it("tier 3: an out-of-range ordinal does not crash or pick the wrong one", () => {
    const doc = load(`<body><main><button>Add to cart</button></main></body>`);
    const result = resolveAnchor({ ...base, ordinal: 7 }, doc);
    // One candidate, ordinal beyond it: take the only match rather than nothing.
    expect(result.el).not.toBeNull();
    expect(result.confidence).toBe("likely");
  });

  // Regression guard for MANDATORY CORRECTION 1. Capture (pageScripts.ts
  // locateScript) computes ordinal by counting within
  // document.querySelectorAll(el.tagName) -- i.e. among elements with the
  // SAME TAG that also match role and name. Under the brief's original,
  // tag-agnostic tier 3 (`doc.querySelectorAll("*")`), this test fails: with
  // the <a role="button"> appearing first in document order, the untagged
  // scan would put it at index 0 and hand back the <a>, not the <button> the
  // anchor actually named.
  it("tier 3 is tag-scoped: an earlier cross-tag role/name match must not steal the ordinal slot", () => {
    const doc = load(`<body><main>
      <a role="button" href="/x">Add to cart</a>
      <button>Add to cart</button>
    </main></body>`);
    const anchor: Anchor = {
      ...base,
      xpath: "/html/body/does/not/resolve",
      tag: "button",
      role: "button",
      name: "Add to cart",
      ordinal: 0,
    };
    const result = resolveAnchor(anchor, doc);
    expect(result.confidence).toBe("likely");
    expect((result.el as HTMLElement).tagName).toBe("BUTTON");
  });

  it("tier 3b takes an unambiguous cross-tag match when the element's tag changed since capture", () => {
    const doc = load(`<body><main><a role="button" href="/x">Add to cart</a></main></body>`);
    const anchor: Anchor = { ...base, xpath: "/html/body/does/not/resolve", tag: "button", role: "button", name: "Add to cart", ordinal: 0 };
    const result = resolveAnchor(anchor, doc);
    expect(result.confidence).toBe("likely");
    expect((result.el as HTMLElement).tagName).toBe("A");
  });

  it("tier 3b declines when two cross-tag candidates exist", () => {
    const doc = load(`<body><main>
      <a role="button" href="/x">Add to cart</a>
      <span role="button">Add to cart</span>
    </main></body>`);
    const anchor: Anchor = { ...base, xpath: "/html/body/does/not/resolve", tag: "button", role: "button", name: "Add to cart", ordinal: 0 };
    const result = resolveAnchor(anchor, doc);
    // Neither same-tag (tier 3, zero <button> candidates) nor unambiguous
    // cross-tag (tier 3b, two candidates) applies. The two remaining
    // candidates also share stems, so tier 5's fuzzy match declines for the
    // same reason -- the whole ladder must come up empty, not guess between
    // the <a> and the <span>.
    expect(result.el).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it("tier 4: matches on exact visible text when the accessible name changed", () => {
    const doc = load(`<body><main><button aria-label="cart-add-1">Add to cart</button></main></body>`);
    const result = resolveAnchor({ ...base, name: "Add to cart (hat)" }, doc);
    expect(result.confidence).toBe("likely");
  });

  it("tier 5: a unique fuzzy match is a guess", () => {
    const doc = load(`<body><main><button>Add hat to your cart</button></main></body>`);
    const result = resolveAnchor({ ...base, text: "" }, doc);
    expect(result.confidence).toBe("guess");
  });

  it("tier 5: DECLINES a fuzzy match with several candidates", () => {
    const doc = load(`<body><main>
      <button>Add hat to your cart</button>
      <button>Add scarf to your cart</button>
    </main></body>`);
    expect(resolveAnchor({ ...base, text: "" }, doc).el).toBeNull();
  });

  // Fix round 2, part (b): anchor.tag arrives from a remote /api/annotations
  // response and is fed straight into querySelectorAll as a CSS selector in
  // tiers 3 and 4. A malformed tag ("1button" -- a type selector cannot start
  // with a digit) throws a DOMException in every real querySelectorAll
  // implementation. Before this fix, tiers 3/4 called querySelectorAll(tag)
  // directly with no try/catch (unlike tier 1's equivalent call), so this
  // would propagate straight out of resolveAnchor() and, upstream, out of
  // mountOverlay() -- see the fix-round-2 regression in main.test.ts.
  it("tier 3/4: a malformed anchor.tag degrades to unlocated instead of throwing", () => {
    const doc = load(`<body><main><p>Sold out</p></main></body>`);
    const anchor: Anchor = {
      ...base,
      xpath: "/html/body/does/not/resolve",
      tag: "1button",
      attrs: {},
    };
    expect(() => resolveAnchor(anchor, doc)).not.toThrow();
    const result = resolveAnchor(anchor, doc);
    expect(result.el).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it("returns unlocated when the element is simply gone", () => {
    const doc = load(`<body><main><p>Sold out</p></main></body>`);
    const result = resolveAnchor(base, doc);
    expect(result.el).toBeNull();
    expect(result.confidence).toBeNull();
  });
});
