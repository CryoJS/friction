import assert from "node:assert/strict";
import test, { describe } from "node:test";
import type { LiveViewResponse } from "@friction/shared";
import { applyLiveView, emptyLane, emptyRunView, type RunView } from "./runState";

function viewWith(primaryUrl: string | null, verify: Record<string, string | null>): RunView {
  const base = emptyRunView("run-1");
  return {
    ...base,
    primary: { ...emptyLane(), liveViewUrl: primaryUrl },
    verify: Object.fromEntries(Object.entries(verify).map(([id, url]) => [id, { ...emptyLane(), liveViewUrl: url }])),
  };
}

const live = (over: Partial<LiveViewResponse>): LiveViewResponse => ({ sessionId: "s1", lane: "primary", fixId: null, liveViewUrl: "https://bb/live", ...over });

describe("applyLiveView", () => {
  test("puts the minted URL on the primary lane", () => {
    const next = applyLiveView(viewWith(null, {}), live({}));
    assert.equal(next.primary.liveViewUrl, "https://bb/live");
  });

  test("puts it on the one verify lane it belongs to, and clears the others", () => {
    const next = applyLiveView(viewWith("stale", { "f-1": "stale", "f-2": "stale" }), live({ lane: "verify", fixId: "f-2" }));
    assert.equal(next.primary.liveViewUrl, null);
    assert.equal(next.verify["f-1"]?.liveViewUrl, null);
    assert.equal(next.verify["f-2"]?.liveViewUrl, "https://bb/live");
  });

  test("clears every lane when no session is open", () => {
    const none: LiveViewResponse = { sessionId: null, lane: null, fixId: null, liveViewUrl: null };
    const next = applyLiveView(viewWith("stale", { "f-1": "stale" }), none);
    assert.equal(next.primary.liveViewUrl, null);
    assert.equal(next.verify["f-1"]?.liveViewUrl, null);
  });

  test("clears every lane when the orchestrator has not answered", () => {
    const next = applyLiveView(viewWith("stale", { "f-1": "stale" }), null);
    assert.equal(next.primary.liveViewUrl, null);
    assert.equal(next.verify["f-1"]?.liveViewUrl, null);
  });

  test("returns the same object when nothing changed, so it forces no re-render", () => {
    const view = viewWith("https://bb/live", { "f-1": null });
    assert.equal(applyLiveView(view, live({})), view);
  });
});
