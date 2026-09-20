import { describe, expect, it, vi } from "vitest";
import type { AnnotationFinding, AnnotationsResponse } from "@friction/shared";
import { mountOverlay, OVERLAY_ROOT_ID } from "./render";

function finding(overrides: Partial<AnnotationFinding> = {}): AnnotationFinding {
  return {
    findingId: "f1",
    category: "dead_click",
    severity: 3,
    summary: "Clicking Add to cart did nothing.",
    whyItMatters: "Shoppers cannot buy the product.",
    recommendation: "Wire up the click handler.",
    url: "",
    anchor: null,
    evidenceUrl: null,
    patchJs: null,
    hitCount: 1,
    ...overrides,
  };
}

function response(findings: AnnotationFinding[]): AnnotationsResponse {
  return { scanId: "s1", scannedAt: Date.now(), url: "https://example.test/", overlayVersion: 1, findings };
}

function load(html: string): Document {
  document.documentElement.innerHTML = html;
  return document;
}

describe("mountOverlay", () => {
  it("mounts a single shadow-root element at OVERLAY_ROOT_ID", () => {
    const doc = load(`<body><button id="add-to-cart">Add to cart</button></body>`);
    const handle = mountOverlay(response([finding()]), doc);
    const root = doc.getElementById(OVERLAY_ROOT_ID);
    expect(root).not.toBeNull();
    expect(root?.shadowRoot).not.toBeNull();
    handle.destroy();
  });

  it("never renders an empty overlay: every finding is listed even when nothing resolves", () => {
    const doc = load(`<body><p>Nothing to click here.</p></body>`);
    const handle = mountOverlay(
      response([
        finding({ findingId: "a", anchor: null }),
        finding({ findingId: "b", anchor: null, summary: "Second finding." }),
      ]),
      doc,
    );
    const root = doc.getElementById(OVERLAY_ROOT_ID);
    const panelText = root?.shadowRoot?.querySelector(".panel")?.textContent ?? "";
    expect(panelText).toContain("2 findings");
    expect(panelText.length).toBeGreaterThan(0);
    handle.destroy();
  });

  it("never renders an empty overlay: an empty findings array still shows an explicit message", () => {
    const doc = load(`<body></body>`);
    const handle = mountOverlay(response([]), doc);
    const root = doc.getElementById(OVERLAY_ROOT_ID);
    const panelText = root?.shadowRoot?.querySelector(".panel")?.textContent ?? "";
    expect(panelText).toContain("No findings were recorded for this scan.");
    handle.destroy();
  });

  describe("positioning", () => {
    it("places a marker from the root's own measured box, independent of whatever containing block the root itself resolved against", () => {
      // happy-dom has no layout engine: getBoundingClientRect() always
      // returns zeros regardless of CSS, so it cannot reproduce "the host
      // page's <body> is position:relative and offsets the containing
      // block" the way a real browser would. What it CAN prove is the
      // property that fix relies on: the renderer must derive a marker's
      // position purely from (target rect − root rect), so that whatever
      // viewport coordinates the root's own box happens to land at -- 0,0,
      // or somewhere else entirely because an ancestor's position/transform
      // hijacked its containing block -- the marker still lands exactly on
      // its target. We control those two rects directly and assert the math.
      const doc = load(`<body style="position:relative"><button id="target">Add to cart</button></body>`);
      const target = doc.getElementById("target")!;

      const original = Element.prototype.getBoundingClientRect;
      const fakeRect = (r: Partial<DOMRect>): DOMRect => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...r }) as DOMRect;
      Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
        if (this.id === OVERLAY_ROOT_ID) {
          // Stand-in for a root box that landed away from the viewport
          // origin -- e.g. because the host body's position:relative (or a
          // transformed ancestor) became the containing block fixed
          // positioning resolved against.
          return fakeRect({ left: 65, top: 40, x: 65, y: 40 });
        }
        if (this === target) {
          return fakeRect({ left: 265, top: 140, right: 320, bottom: 172, width: 55, height: 32, x: 265, y: 140 });
        }
        return original.call(this);
      };

      try {
        const anchor = {
          xpath: "/html/body/button",
          tag: "button",
          role: "button",
          name: "Add to cart",
          text: "Add to cart",
          attrs: { id: "target" },
          ordinal: 0,
          path: "/",
        };
        const handle = mountOverlay(response([finding({ anchor })]), doc);
        const root = doc.getElementById(OVERLAY_ROOT_ID)!;
        const marker = root.shadowRoot!.querySelector(".marker") as HTMLElement;
        expect(marker.style.left).toBe(`${265 - 65}px`);
        expect(marker.style.top).toBe(`${140 - 40}px`);
        handle.destroy();
      } finally {
        Element.prototype.getBoundingClientRect = original;
      }
    });
  });

  describe("destroy()", () => {
    it("removes the root element from the document", () => {
      const doc = load(`<body></body>`);
      const handle = mountOverlay(response([finding()]), doc);
      expect(doc.getElementById(OVERLAY_ROOT_ID)).not.toBeNull();
      handle.destroy();
      expect(doc.getElementById(OVERLAY_ROOT_ID)).toBeNull();
    });

    it("removes the scroll and resize listeners it added, and disconnects its ResizeObserver", () => {
      const doc = load(`<body></body>`);
      const win = doc.defaultView!;

      const addDocSpy = vi.spyOn(doc, "addEventListener");
      const removeDocSpy = vi.spyOn(doc, "removeEventListener");
      const addWinSpy = vi.spyOn(win, "addEventListener");
      const removeWinSpy = vi.spyOn(win, "removeEventListener");

      const disconnectSpy = vi.fn();
      const observeSpy = vi.fn();
      const OriginalRO = win.ResizeObserver;
      class FakeResizeObserver {
        observe = observeSpy;
        disconnect = disconnectSpy;
        unobserve = vi.fn();
      }
      win.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
      globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;

      const handle = mountOverlay(response([finding()]), doc);

      const scrollCall = addDocSpy.mock.calls.find((c) => c[0] === "scroll");
      const resizeCall = addWinSpy.mock.calls.find((c) => c[0] === "resize");
      expect(scrollCall).toBeDefined();
      expect(resizeCall).toBeDefined();
      expect(observeSpy).toHaveBeenCalled();

      handle.destroy();

      expect(removeDocSpy).toHaveBeenCalledWith("scroll", scrollCall?.[1], scrollCall?.[2]);
      expect(removeWinSpy).toHaveBeenCalledWith("resize", resizeCall?.[1]);
      expect(disconnectSpy).toHaveBeenCalled();

      win.ResizeObserver = OriginalRO;
      addDocSpy.mockRestore();
      removeDocSpy.mockRestore();
      addWinSpy.mockRestore();
      removeWinSpy.mockRestore();
    });

    it("is safe to call when nothing resolved (no entries, no markers)", () => {
      const doc = load(`<body></body>`);
      const handle = mountOverlay(response([finding({ anchor: null })]), doc);
      expect(() => handle.destroy()).not.toThrow();
      expect(doc.getElementById(OVERLAY_ROOT_ID)).toBeNull();
    });
  });

  describe("focusFinding()", () => {
    it("opens the card and scrolls the element into view for a located finding", () => {
      const doc = load(`<body><button id="add-to-cart">Add to cart</button></body>`);
      const target = doc.getElementById("add-to-cart")!;
      const scrollSpy = vi.fn();
      // happy-dom implements scrollIntoView as a no-op; spy on it to assert intent.
      target.scrollIntoView = scrollSpy;

      const anchor = {
        xpath: "/html/body/button",
        tag: "button",
        role: "button",
        name: "Add to cart",
        text: "Add to cart",
        attrs: { id: "add-to-cart" },
        ordinal: 0,
        path: "/",
      };
      const handle = mountOverlay(response([finding({ anchor })]), doc);

      handle.focusFinding("f1");
      expect(scrollSpy).toHaveBeenCalled();
      const root = doc.getElementById(OVERLAY_ROOT_ID);
      const card = root?.shadowRoot?.querySelector(".card") as HTMLElement | undefined;
      expect(card?.hidden).toBe(false);

      handle.destroy();
    });

    it("does nothing for an unknown findingId", () => {
      const doc = load(`<body></body>`);
      const handle = mountOverlay(response([finding()]), doc);
      expect(() => handle.focusFinding("does-not-exist")).not.toThrow();
      handle.destroy();
    });
  });
});
