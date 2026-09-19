import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { MAX_SCAN_TASKS, parseGeneratedTasks } from "@friction/shared";
import { fallbackScanTasks } from "./taskGen";

describe("fallbackScanTasks", () => {
  test("returns exactly the number of tasks a scan runs", () => {
    // The fallback IS the scan in mock mode and whenever the site cannot be read,
    // so a scan must not silently run fewer (or more) tasks than MAX_SCAN_TASKS.
    assert.equal(fallbackScanTasks("https://shop.example.com").length, MAX_SCAN_TASKS);
  });

  test("survives the same parse the model's tasks go through", () => {
    const tasks = fallbackScanTasks("https://shop.example.com");
    assert.equal(parseGeneratedTasks({ tasks }).length, MAX_SCAN_TASKS);
  });

  test("proposes no two tasks with the same title", () => {
    const titles = fallbackScanTasks("https://shop.example.com").map((t) => t.title.toLowerCase());
    assert.equal(new Set(titles).size, titles.length);
  });

  test("names the host rather than the full URL", () => {
    assert.ok(fallbackScanTasks("https://www.shop.example.com/deals?x=1").every((t) => t.title.includes("shop.example.com")));
  });
});
