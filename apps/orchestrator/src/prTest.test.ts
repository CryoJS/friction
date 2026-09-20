import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFixTest } from "./prTest";

describe("parseFixTest", () => {
  const step = { action: "click", role: "button", name: "Add to cart", value: null, path: null, key: null, ms: null };
  const expectation = { kind: "text_visible", role: null, name: null, text: "Please select a size", value: null };

  it("reads the model's flat, nullable answer as the test it describes", () => {
    const test = parseFixTest({ title: "Add to cart says a size is needed", startPath: "/products/parka", steps: [step, { ...step, action: "wait", role: null, name: null, ms: 4000 }], expect: [expectation] });
    assert.deepEqual(test.steps, [{ action: "click", role: "button", name: "Add to cart" }, { action: "wait", ms: 4000 }]);
    assert.deepEqual(test.expect, [{ kind: "text_visible", text: "Please select a size" }]);
  });

  it("refuses an answer that leaves the site, names no element, or asserts nothing", () => {
    const base = { title: "Add to cart says a size is needed", startPath: "/products/parka", steps: [step], expect: [expectation] };
    assert.throws(() => parseFixTest({ ...base, startPath: "https://evil.example/" }));
    assert.throws(() => parseFixTest({ ...base, steps: [{ ...step, name: null }] }));
    assert.throws(() => parseFixTest({ ...base, steps: [{ ...step, action: "goto", path: "//evil.example" }] }));
    assert.throws(() => parseFixTest({ ...base, expect: [] }));
    assert.throws(() => parseFixTest("try { } catch (e) {}"));
  });
});
