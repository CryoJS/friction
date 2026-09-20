/**
 * Scan helpers: the pure pieces the orchestrator, the Worker and the control
 * room have to agree on.
 *
 *   pnpm test
 */
import { describe, expect, it } from "vitest";
import {
  CreateRunRequestSchema,
  MAX_SCAN_TASKS,
  MAX_STORED_TASK_INDEX,
  ScanPatchSchema,
  ScanTaskLinkSchema,
  TaskPullRequestSchema,
  isScanFinished,
  issueKey,
  issuePath,
  normalizeIssueLabel,
  parseGeneratedTasks,
  parseScanNode,
  pickCrawlLinks,
  scanNodeId,
  taskVerdict,
  type GeneratedTask,
} from "./index";

const task = (title: string): GeneratedTask => ({ title, whyCritical: "It matters.", successCheck: "The page shows it." });

describe("parseGeneratedTasks", () => {
  it("keeps valid tasks in order", () => {
    const tasks = [task("Add a jacket to the cart"), task("Find the returns policy")];
    expect(parseGeneratedTasks({ tasks })).toEqual(tasks);
  });

  it("drops invalid entries instead of rejecting the batch", () => {
    const parsed = parseGeneratedTasks({ tasks: [task("Find the returns policy"), { title: "x", whyCritical: "", successCheck: "" }, "nope", null] });
    expect(parsed.map((t) => t.title)).toEqual(["Find the returns policy"]);
  });

  it("drops duplicate titles, ignoring case", () => {
    expect(parseGeneratedTasks({ tasks: [task("Find the returns policy"), task("find the RETURNS policy")] })).toHaveLength(1);
  });

  it(`caps at ${MAX_SCAN_TASKS}`, () => {
    const many = Array.from({ length: 14 }, (_, i) => task(`Open product number ${i + 1}`));
    expect(parseGeneratedTasks({ tasks: many })).toHaveLength(MAX_SCAN_TASKS);
  });

  it("trims whitespace", () => {
    expect(parseGeneratedTasks({ tasks: [{ title: "  Find the returns policy ", whyCritical: " x ", successCheck: " y " }] })).toEqual([
      { title: "Find the returns policy", whyCritical: "x", successCheck: "y" },
    ]);
  });

  it("returns nothing for input that is not { tasks: [...] }", () => {
    expect(parseGeneratedTasks(null)).toEqual([]);
    expect(parseGeneratedTasks({ tasks: "nope" })).toEqual([]);
    expect(parseGeneratedTasks([task("Find the returns policy")])).toEqual([]);
  });
});

describe("taskVerdict", () => {
  it("is pending until the agent finishes", () => {
    expect(taskVerdict("idle")).toBe("pending");
    expect(taskVerdict("running")).toBe("pending");
  });

  it("is pass when the agent succeeded", () => {
    expect(taskVerdict("succeeded")).toBe("pass");
  });

  it("is fail when it failed or ran out of time", () => {
    expect(taskVerdict("failed")).toBe("fail");
    expect(taskVerdict("timeout")).toBe("fail");
  });
});

describe("pickCrawlLinks", () => {
  const base = "https://shop.example/";

  it("keeps same-origin page links in navigation order, deduplicated by path, capped", () => {
    const hrefs = [
      "/products",
      "https://shop.example/products/",
      "https://other.example/x",
      "mailto:hi@shop.example",
      "#top",
      "/login",
      "/my-account",
      "/guide.pdf",
      "/about?ref=nav#team",
      "/help",
      "/pricing",
      "/blog",
      "/careers",
    ];
    expect(pickCrawlLinks(base, hrefs)).toEqual([
      "https://shop.example/products",
      "https://shop.example/about?ref=nav",
      "https://shop.example/help",
      "https://shop.example/pricing",
      "https://shop.example/blog",
    ]);
  });

  it("skips auth and account paths but not words that merely contain them", () => {
    expect(pickCrawlLinks(base, ["/sign-in", "/signup", "/auth/callback", "/reset-password", "/accounting", "/authors"])).toEqual([
      "https://shop.example/accounting",
      "https://shop.example/authors",
    ]);
  });

  it("never returns the base page itself", () => {
    expect(pickCrawlLinks(base, ["/", "https://shop.example", "/#main"])).toEqual([]);
  });

  it("treats http and https as different origins", () => {
    expect(pickCrawlLinks(base, ["http://shop.example/help"])).toEqual([]);
  });

  it("honours max and survives a bad base URL", () => {
    expect(pickCrawlLinks(base, ["/a", "/b", "/c"], 2)).toEqual(["https://shop.example/a", "https://shop.example/b"]);
    expect(pickCrawlLinks("not a url", ["/a"])).toEqual([]);
  });
});

describe("issue keys", () => {
  it("normalizes the path: lowercase, no trailing slash, no query or hash", () => {
    expect(issuePath("https://s.example/Cart/?step=2#top")).toBe("/cart");
    expect(issuePath("https://s.example/")).toBe("/");
    expect(issuePath("https://s.example")).toBe("/");
  });

  it("uses an empty path when there is no usable URL", () => {
    expect(issuePath(null)).toBe("");
    expect(issuePath("not a url")).toBe("");
  });

  it("normalizes labels: trimmed, lowercase, single spaces", () => {
    expect(normalizeIssueLabel("  Add   to\nCart ")).toBe("add to cart");
  });

  it("matches the same element on the same page across runs", () => {
    expect(issueKey("dead_click", "https://s.example/cart?x=1", " Checkout ")).toBe(issueKey("dead_click", "https://s.example/Cart/", "checkout"));
    expect(issueKey("dead_click", "https://s.example/cart", "Checkout")).toBe("dead_click|/cart|checkout");
  });

  it("keeps different categories apart", () => {
    expect(issueKey("dead_click", "https://s.example/cart", "Checkout")).not.toBe(issueKey("retry", "https://s.example/cart", "Checkout"));
  });
});

describe("scan node ids", () => {
  it("round-trips root and task nodes", () => {
    for (const id of ["root", "t0", "t9"]) expect(scanNodeId(parseScanNode(id))).toBe(id);
  });

  it("parses the parts", () => {
    expect(parseScanNode("t4")).toEqual({ kind: "task", index: 4 });
  });

  it("opens the task for a link from when tasks had persona children", () => {
    expect(parseScanNode("t2.cautious")).toEqual({ kind: "task", index: 2 });
  });

  it("falls back to root for anything else", () => {
    for (const id of [null, undefined, "", "x", "t", "t1.keyboard.extra", "t1.", "T1"]) expect(parseScanNode(id)).toEqual({ kind: "root" });
  });
});

describe("scan contracts", () => {
  it("accepts a run with or without a scan link, and rejects an out-of-range task index", () => {
    const base = { url: "https://s.example", task: "Find it" };
    const link = { scanId: "s_1", taskIndex: 3, whyCritical: "a", successCheck: "b" };
    expect(CreateRunRequestSchema.safeParse(base).success).toBe(true);
    expect(CreateRunRequestSchema.safeParse({ ...base, scan: link }).success).toBe(true);
    expect(CreateRunRequestSchema.safeParse({ ...base, scan: { ...link, taskIndex: 10 } }).success).toBe(false);
  });

  it("a stored record of task 10 still parses while new scans run MAX_SCAN_TASKS tasks", () => {
    // MAX_SCAN_TASKS went from 10 to 5, and every recorded pull request of tasks 6-10 vanished from the tree.
    expect(MAX_SCAN_TASKS).toBe(5);
    expect(MAX_STORED_TASK_INDEX).toBeGreaterThanOrEqual(9);
    const stored = { scanId: "s_bho3s38tua", runId: "r_1", taskIndex: 9, status: "nothing_to_fix", findingIds: [], notFixed: [{ findingId: "f8", reason: "Covered by the PR for task 8.", coveredBy: 7 }] };
    expect(TaskPullRequestSchema.safeParse(stored).success).toBe(true);
    expect(TaskPullRequestSchema.safeParse({ ...stored, status: "covered", coveredBy: 9 }).success).toBe(true);
    expect(ScanTaskLinkSchema.safeParse({ scanId: "s_1", taskIndex: 9, whyCritical: "a", successCheck: "b" }).success).toBe(true);
    expect(parseScanNode("t9")).toEqual({ kind: "task", index: 9 });
  });

  it("accepts partial scan patches and rejects unknown statuses", () => {
    expect(ScanPatchSchema.safeParse({ page: { url: "https://s.example/help", title: "Help" }, message: "Reading /help (2/3)" }).success).toBe(true);
    expect(ScanPatchSchema.safeParse({ status: "done" }).success).toBe(false);
  });

  it("knows when a scan is finished", () => {
    expect(isScanFinished("completed")).toBe(true);
    expect(isScanFinished("failed")).toBe(true);
    expect(isScanFinished("cancelled")).toBe(true);
    expect(isScanFinished("crawling")).toBe(false);
    expect(isScanFinished("running")).toBe(false);
  });
});
