/**
 * main.ts is the bookmarklet's entry point: it runs its side effect (main())
 * on import, the same way it runs the instant a real page evaluates the
 * built IIFE. Testing it means controlling the globals it reads (fetch,
 * WORKER_ORIGIN/CONTROL_ROOM_ORIGIN, which build.mjs normally injects via
 * esbuild's `define` and are therefore just plain globals here) BEFORE a
 * fresh dynamic import, then letting its async chain settle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_ROOT_ID } from "./render";

const ANNOTATIONS_KEY = "__friction_annotations";

// Fix round 2, part (a): render.ts's real mountOverlay appends its root to
// doc.body BEFORE it finishes resolving every finding (see render.ts), so a
// throw partway through -- e.g. a malformed anchor.tag reaching
// querySelectorAll before resolve.ts's fix round 2 guard -- leaves a first,
// broken root already in the document when main.ts's error fallback tries
// to mount a second one under the same id. Mocking mountOverlay to
// reproduce exactly that ordering (append, then throw) lets the test assert
// main.ts's own idempotence fix without needing a real malformed anchor to
// reach resolve.ts.
vi.mock("./render", async (importOriginal) => {
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

async function flush(): Promise<void> {
  // A few microtask/macrotask turns: main()'s chain is fetch -> res.json()
  // -> mount, each an awaited promise.
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function panelText(): string | null {
  const root = document.getElementById(OVERLAY_ROOT_ID);
  return root?.shadowRoot?.querySelector(".panel-body")?.textContent ?? null;
}

describe("main.ts entry point", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as unknown as { __frictionOverlay?: unknown }).__frictionOverlay;
    sessionStorage.clear();
    vi.resetModules();
    (globalThis as Record<string, unknown>).WORKER_ORIGIN = "http://localhost:8787";
    (globalThis as Record<string, unknown>).CONTROL_ROOM_ORIGIN = "http://localhost:5173";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Fix round 1, Finding 1: mounts an error panel, not nothing, when the 200 body fails to parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
      } as unknown as Response),
    );

    await import("./main");
    await flush();

    const root = document.getElementById(OVERLAY_ROOT_ID);
    expect(root).not.toBeNull();
    const text = panelText();
    expect(text).toBeTruthy();
    expect(text).toContain("Friction's response couldn't be read");

    // The failure must still register the sentinel, or a second click can
    // never toggle this error panel back off.
    expect((window as unknown as { __frictionOverlay?: { version: number } }).__frictionOverlay?.version).toBe(1);
  });

  it("Fix round 1, Finding 3: a network TypeError while online hedges between CSP and an unreachable worker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    vi.stubGlobal("navigator", { onLine: true });

    await import("./main");
    await flush();

    const text = panelText();
    expect(text).toContain("Content-Security-Policy");
    expect(text).toContain("unreachable");
    expect(text).not.toMatch(/^This site's Content-Security-Policy blocked/);
  });

  it("Fix round 1, Finding 3: navigator.onLine === false is reported as offline, not CSP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    vi.stubGlobal("navigator", { onLine: false });

    await import("./main");
    await flush();

    expect(panelText()).toBe("You appear to be offline.");
  });

  it("Fix round 1, Finding 2: the 404 link points at CONTROL_ROOM_ORIGIN, not the worker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) } as unknown as Response),
    );

    await import("./main");
    await flush();

    const root = document.getElementById(OVERLAY_ROOT_ID);
    const link = root?.shadowRoot?.querySelector(".panel-body a") as HTMLAnchorElement | null;
    expect(link?.href).toBe("http://localhost:5173/");
  });

  it("Fix round 1, Minor: a second click while the first fetch is still in flight is a no-op", async () => {
    // A javascript: bookmarklet click is a fresh top-level script evaluation
    // every time -- there is no shared module scope between two clicks, only
    // shared `window` state. So the real regression test is: reset the
    // module registry between "clicks" (a fresh main.ts closure each time,
    // exactly like a fresh paste) while keeping `window` and the fetch mock
    // shared, and confirm the SECOND click's main() never calls fetch at all
    // because it sees window.__frictionRequestInFlight still true from the
    // first click's still-pending request.
    let resolveFetch!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);

    await import("./main"); // first click
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.resetModules(); // second click starts from a brand-new module closure
    await import("./main"); // second click, first request still pending
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); // not called again

    resolveFetch({ ok: false, status: 404, json: () => Promise.resolve({}) });
    await flush();
  });

  it("Fix round 2, part (a): exactly one #__friction-root survives a mid-mount throw, and it's the error panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ scanId: "s1", scannedAt: 0, url: "https://example.test/", overlayVersion: 1, findings: [] }),
      } as unknown as Response),
    );

    await import("./main");
    await flush();

    // Without the fix, the mocked mountOverlay's own root (appended before
    // it throws) is orphaned: document.getElementById only ever returns the
    // FIRST match, so it would report the broken node while a SECOND root
    // (the error panel) sits unreachable behind it. Asserting the COUNT,
    // not just getElementById's result, is what actually catches that.
    const roots = document.querySelectorAll(`#${OVERLAY_ROOT_ID}`);
    expect(roots).toHaveLength(1);
    expect(panelText()).toContain("Friction couldn't display this scan");

    // Fix round 2, part (c): a response that crashed the mount must never
    // reach sessionStorage, or every future click reads back the same
    // poison and crashes the same way.
    expect(sessionStorage.getItem(ANNOTATIONS_KEY)).toBeNull();
  });

  it("Fix round 2, part (c): a cached response that fails to mount is cleared, not left to poison every future click", async () => {
    sessionStorage.setItem(
      ANNOTATIONS_KEY,
      JSON.stringify({
        host: location.hostname,
        response: { scanId: "s1", scannedAt: 0, url: "https://example.test/", overlayVersion: 1, findings: [] },
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await import("./main");
    await flush();

    expect(fetchMock).not.toHaveBeenCalled(); // this was a cache hit, not a fetch
    const roots = document.querySelectorAll(`#${OVERLAY_ROOT_ID}`);
    expect(roots).toHaveLength(1);
    expect(panelText()).toContain("Friction couldn't display this scan");
    expect(sessionStorage.getItem(ANNOTATIONS_KEY)).toBeNull();
  });
});
