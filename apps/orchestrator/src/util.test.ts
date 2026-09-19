import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { withTimeoutDisposing } from "./util";

/** A promise plus the handles to settle it later. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withTimeoutDisposing", () => {
  test("returns the value and disposes nothing when the work beats the deadline", async () => {
    const disposed: string[] = [];
    const value = await withTimeoutDisposing(Promise.resolve("session-a"), 1000, "open", async (late) => {
      disposed.push(late);
    });
    assert.equal(value, "session-a");
    assert.deepEqual(disposed, []);
  });

  test("disposes the resource that arrives after the deadline", async () => {
    const work = deferred<string>();
    const disposed: string[] = [];

    await assert.rejects(
      withTimeoutDisposing(work.promise, 10, "browser session", async (late) => {
        disposed.push(late);
      }),
      /browser session timed out/,
    );

    // The abandoned open finishes anyway: it owns a real remote session, so it MUST be closed.
    assert.deepEqual(disposed, [], "nothing to dispose while the work is still running");
    work.resolve("session-b");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(disposed, ["session-b"]);
  });

  test("does not dispose when the work itself fails before the deadline", async () => {
    const disposed: string[] = [];
    await assert.rejects(
      withTimeoutDisposing(Promise.reject<string>(new Error("no capacity")), 1000, "open", async (late) => {
        disposed.push(late);
      }),
      /no capacity/,
    );
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(disposed, []);
  });

  test("a failing dispose never becomes an unhandled rejection", async () => {
    const work = deferred<string>();
    await assert.rejects(
      withTimeoutDisposing(work.promise, 10, "open", async () => {
        throw new Error("close failed");
      }),
      /open timed out/,
    );
    work.resolve("session-c");
    await new Promise((r) => setImmediate(r));
    // Reaching here without an unhandled rejection crashing the runner is the assertion.
    assert.ok(true);
  });
});
