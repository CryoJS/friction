/**
 * offline.ts runs its side effect (main()) on import, synchronously -- unlike
 * main.ts there is no fetch to await, so unlike main.test.ts these tests need
 * no flush(). Each test sets up window.__FRICTION_DATA__/__frictionOverlay
 * BEFORE a fresh dynamic import, mirroring main.test.ts's pattern for the
 * same reason: a javascript: bookmarklet click is a fresh top-level script
 * evaluation every time, so only `window` state carries between "clicks".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationsResponse } from "@friction/shared";
import { OVERLAY_ROOT_ID } from "./render";

function panelText(): string | null {
  const root = document.getElementById(OVERLAY_ROOT_ID);
  return root?.shadowRoot?.querySelector(".panel-body")?.textContent ?? null;
}

const baseResponse: AnnotationsResponse = {
  scanId: "s1",
  scannedAt: 0,
  url: "https://example.test/",
  overlayVersion: 1,
  findings: [],
};

describe("offline.ts entry point", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as unknown as { __frictionOverlay?: unknown }).__frictionOverlay;
    delete (window as unknown as { __FRICTION_DATA__?: unknown }).__FRICTION_DATA__;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts straight from window.__FRICTION_DATA__, with no fetch involved", async () => {
    (window as unknown as { __FRICTION_DATA__: AnnotationsResponse }).__FRICTION_DATA__ = baseResponse;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await import("./offline");

    expect(fetchMock).not.toHaveBeenCalled();
    const root = document.getElementById(OVERLAY_ROOT_ID);
    expect(root).not.toBeNull();
    expect(panelText()).toContain("No findings were recorded for this scan.");
    expect((window as unknown as { __frictionOverlay?: { version: number } }).__frictionOverlay?.version).toBe(1);
  });

  it("a second click toggles the overlay off, same as main.ts's sentinel", async () => {
    (window as unknown as { __FRICTION_DATA__: AnnotationsResponse }).__FRICTION_DATA__ = baseResponse;

    await import("./offline"); // first click: mounts
    expect(document.getElementById(OVERLAY_ROOT_ID)).not.toBeNull();

    vi.resetModules(); // second click starts from a fresh module closure
    await import("./offline"); // second click: window.__frictionOverlay is already set, so this toggles off

    expect(document.getElementById(OVERLAY_ROOT_ID)).toBeNull();
    expect((window as unknown as { __frictionOverlay?: unknown }).__frictionOverlay).toBeUndefined();
  });

  it("mounts a message panel, not nothing, when __FRICTION_DATA__ is missing", async () => {
    await import("./offline");

    const root = document.getElementById(OVERLAY_ROOT_ID);
    expect(root).not.toBeNull();
    expect(panelText()).toContain("no scan data found");
    // Still registers the sentinel, so a second click can toggle this panel off too.
    expect((window as unknown as { __frictionOverlay?: { version: number } }).__frictionOverlay?.version).toBe(1);
  });

  it("adds the staleness notice when the inlined payload is newer than this bundle", async () => {
    (window as unknown as { __FRICTION_DATA__: AnnotationsResponse }).__FRICTION_DATA__ = {
      ...baseResponse,
      overlayVersion: 999,
    };

    await import("./offline");

    expect(panelText()).toContain("out of date");
  });

  it("exactly one #__friction-root survives a mid-mount throw, and it's the error panel", async () => {
    // Mirrors main.test.ts's mock for the identical orphan-root scenario:
    // render.ts's real mountOverlay appends its root BEFORE it finishes
    // resolving every finding, so a throw partway through can leave a first,
    // broken root behind when the catch below tries to mount a second one
    // under the same id.
    vi.doMock("./render", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./render")>();
      return {
        ...actual,
        mountOverlay: vi.fn(() => {
          const stray = document.createElement("div");
          stray.id = actual.OVERLAY_ROOT_ID;
          document.body.appendChild(stray);
          throw new Error("boom: simulated mid-mount crash");
        }),
      };
    });
    (window as unknown as { __FRICTION_DATA__: AnnotationsResponse }).__FRICTION_DATA__ = baseResponse;

    await import("./offline");

    const roots = document.querySelectorAll(`#${OVERLAY_ROOT_ID}`);
    expect(roots).toHaveLength(1);
    expect(panelText()).toContain("Friction couldn't display this scan");
  });
});
