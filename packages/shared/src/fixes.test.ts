/**
 * The pure rules behind fix verification and pull requests.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PATCH_LINES,
  checkGeneratedFile,
  describeComparison,
  guardPatch,
  judgeVerification,
  rankSearchHits,
  searchTermsFor,
  selectTopFindings,
  unwrapFence,
  buildPullRequest,
  fixBranchName,
  pullRequestTitle,
  validatePatch,
  type PullRequestFacts,
  type VerifyObservation,
} from "./fixes";

const GOOD = [
  "// Tells the visitor to pick a size.",
  "try {",
  '  document.addEventListener("click", function (e) {',
  "    try {",
  '      var add = e.target && e.target.closest && e.target.closest("#add");',
  '      if (add && !document.querySelector("input[name=size]:checked")) {',
  '        document.getElementById("err").textContent = "Please select a size.";',
  "      }",
  "    } catch (err) {}",
  "  }, true);",
  "} catch (err) {}",
].join("\n");

describe("validatePatch", () => {
  it("accepts a defensive, self-contained patch", () => {
    expect(validatePatch(GOOD)).toBeNull();
  });

  it(`caps patches at ${MAX_PATCH_LINES} lines`, () => {
    const long = ["try {", ...Array.from({ length: MAX_PATCH_LINES }, () => "  void 0;"), "} catch (e) {}"].join("\n");
    expect(validatePatch(long)).toMatch(/cap is 40/);
  });

  it("requires try/catch", () => {
    expect(validatePatch('document.title = "x";')).toMatch(/try\/catch/);
  });

  it("rejects network, navigation, cookies and eval", () => {
    const wrap = (body: string): string => `try { ${body} } catch (e) {}`;
    expect(validatePatch(wrap('fetch("/api")'))).toMatch(/network/);
    expect(validatePatch(wrap("navigator.sendBeacon('/x')"))).toMatch(/network/);
    expect(validatePatch(wrap('location.href = "/cart"'))).toMatch(/navigates/);
    expect(validatePatch(wrap('location = "/cart"'))).toMatch(/navigates/);
    expect(validatePatch(wrap('window.open("/x")'))).toMatch(/navigates/);
    expect(validatePatch(wrap('document.cookie = "a=1"'))).toMatch(/cookies/);
    expect(validatePatch(wrap('eval("1")'))).toMatch(/strings/);
  });

  it("allows reading the route, which scoping a patch to a page needs", () => {
    expect(validatePatch('try { if (location.pathname === "/products/x") { document.title = "x"; } } catch (e) {}')).toBeNull();
  });

  it("rejects code that does not parse, and markdown fences", () => {
    expect(validatePatch("try { if ( } catch (e) {}")).toMatch(/does not parse/);
    expect(validatePatch("```js\ntry {} catch (e) {}\n```")).toMatch(/fences/);
    expect(validatePatch("   ")).toMatch(/empty/);
  });
});

describe("guardPatch", () => {
  it("wraps the patch so even a stray throw cannot escape", () => {
    const guarded = guardPatch('throw new Error("boom");');
    expect(() => new Function(guarded)()).not.toThrow();
    expect(guarded).toContain('throw new Error("boom");');
  });
});

describe("selectTopFindings", () => {
  const f = (findingId: string, severity: number, confidence: number, hitCount: number) => ({ findingId, severity, confidence, hitCount });

  it("takes the top N by severity, then confidence, then hits", () => {
    const picked = selectTopFindings([f("a", 3, 0.9, 1), f("b", 5, 0.8, 1), f("c", 4, 0.7, 3), f("d", 5, 0.9, 1)], 2);
    expect(picked.map((x) => x.findingId)).toEqual(["d", "b"]);
  });

  it("never returns more than exist, and nothing for N = 0", () => {
    expect(selectTopFindings([f("a", 3, 0.9, 1)], 5)).toHaveLength(1);
    expect(selectTopFindings([f("a", 3, 0.9, 1)], 0)).toEqual([]);
  });
});

describe("describeComparison", () => {
  it("states both sides concretely", () => {
    expect(describeComparison({ outcome: "timeout", steps: 13, durationMs: 1 }, { outcome: "success", steps: 4, durationMs: 1 })).toBe(
      "completed the task in 4 steps, down from 13 steps and a timeout",
    );
    expect(describeComparison({ outcome: "success", steps: 9, durationMs: 1 }, { outcome: "success", steps: 9, durationMs: 1 })).toBe(
      "completed the task in 9 steps, no change from before",
    );
    expect(describeComparison({ outcome: "failure", steps: 14, durationMs: 1 }, { outcome: "failure", steps: 15, durationMs: 1 })).toBe(
      "gave up after 15 steps, up from 14 steps and giving up",
    );
  });
});

describe("judgeVerification", () => {
  const before = { outcome: "timeout" as const, steps: 13, durationMs: 60_000 };
  const observed = (over: Partial<VerifyObservation> = {}): VerifyObservation => ({
    result: { outcome: "timeout", steps: 13, durationMs: 60_000 },
    errored: false,
    patchActive: true,
    categoryHits: 0,
    reachedFindingPage: true,
    ...over,
  });

  it("verifies when the outcome went from failure or timeout to success", () => {
    const verdict = judgeVerification({ category: "dead_click", before, after: observed({ result: { outcome: "success", steps: 4, durationMs: 20_000 }, categoryHits: 1 }) });
    expect(verdict.stage).toBe("verified");
    expect(verdict.note).toBe("With the fix, the agent completed the task in 4 steps, down from 13 steps and a timeout.");
  });

  it("verifies when the category no longer fires on the page where it used to", () => {
    expect(judgeVerification({ category: "modal_interrupt", before, after: observed() }).stage).toBe("verified");
  });

  it("rejects when the category still fires, and says how often", () => {
    const verdict = judgeVerification({ category: "dead_click", before, after: observed({ categoryHits: 3 }) });
    expect(verdict.stage).toBe("rejected");
    expect(verdict.note).toMatch(/dead_click still fires \(3 times\)/);
  });

  it("never verifies by default: no run, no loaded patch, or never reaching the page is a rejection", () => {
    expect(judgeVerification({ category: "dead_click", before, after: observed({ errored: true, result: { outcome: "failure", steps: 0, durationMs: 1 } }) }).stage).toBe("rejected");
    expect(judgeVerification({ category: "dead_click", before, after: observed({ patchActive: false, result: { outcome: "success", steps: 4, durationMs: 1 } }) }).stage).toBe("rejected");
    const unreached = judgeVerification({ category: "dead_click", before, after: observed({ reachedFindingPage: false }) });
    expect(unreached.stage).toBe("rejected");
    expect(unreached.note).toMatch(/never reached the page/);
  });

  it("a success that stays a success is not an outcome flip: it needs the category gone", () => {
    const ok = { outcome: "success" as const, steps: 15, durationMs: 1 };
    expect(judgeVerification({ category: "dead_click", before: ok, after: observed({ result: ok, categoryHits: 2 }) }).stage).toBe("rejected");
  });
});

describe("searchTermsFor", () => {
  it("strips CSS syntax down to what the source contains", () => {
    expect(searchTermsFor({ selector: "button[data-add-to-cart]", targetLabel: "" })).toEqual(["data-add-to-cart"]);
    expect(searchTermsFor({ selector: "#add-to-cart.btn-primary", targetLabel: "" })).toEqual(["add-to-cart", "btn-primary"]);
    expect(searchTermsFor({ selector: 'input[name="size"]', targetLabel: "" })).toEqual(["size"]);
  });

  it("reads XPath predicates, and gets nothing from bare structure", () => {
    expect(searchTermsFor({ selector: "xpath=//button[@data-testid='buy-now']", targetLabel: "" })).toEqual(["buy-now"]);
    expect(searchTermsFor({ selector: "xpath=/html/body/main/div/div[2]/form/button", targetLabel: "" })).toEqual([]);
  });

  it("falls back to the accessible name, then other visible text, without duplicates", () => {
    expect(searchTermsFor({ selector: "xpath=/html/body/main/button", targetLabel: "Add to cart", texts: ["add to cart", "Get 10% off your first order"] })).toEqual([
      "Add to cart",
      "Get 10% off your first order",
    ]);
  });
});

describe("rankSearchHits", () => {
  const terms = ["data-add-to-cart", "Add to cart"];

  it("prefers the component that matches the most specific terms, and never tests, build output or data files", () => {
    const ranked = rankSearchHits(
      [
        { path: "src/locales/en.json", terms: ["Add to cart"] },
        { path: "dist/assets/index-abc.js", terms: ["data-add-to-cart", "Add to cart"] },
        { path: "src/components/ProductForm.test.tsx", terms: ["data-add-to-cart"] },
        { path: "src/pages/cart.tsx", terms: ["Add to cart"] },
        { path: "src/components/ProductForm.tsx", terms: ["data-add-to-cart"] },
        { path: "src/components/ProductForm.tsx", terms: ["Add to cart"] },
      ],
      terms,
    );
    expect(ranked.map((h) => h.path)).toEqual(["src/components/ProductForm.tsx", "src/pages/cart.tsx"]);
  });

  it("returns nothing when nothing is usable", () => {
    expect(rankSearchHits([{ path: "README.md", terms: ["Add to cart"] }], terms)).toEqual([]);
  });
});

describe("checkGeneratedFile", () => {
  const original = Array.from({ length: 40 }, (_, i) => `const line${i} = ${i};`).join("\n");

  it("accepts a complete, changed file", () => {
    expect(checkGeneratedFile(original, `${original}\nconst added = true;`)).toBeNull();
  });

  it("refuses empty, identical, fenced, diff-shaped and truncated output", () => {
    expect(checkGeneratedFile(original, "  ")).toMatch(/empty/);
    expect(checkGeneratedFile(original, original)).toMatch(/identical/);
    expect(checkGeneratedFile(original, "```tsx\nconst a = 1;\n```")).toMatch(/fences/);
    expect(checkGeneratedFile(original, `--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n${original}`)).toMatch(/diff/);
    expect(checkGeneratedFile(original, original.split("\n").slice(0, 10).join("\n"))).toMatch(/truncated/);
  });
});

describe("unwrapFence", () => {
  it("unwraps a whole-answer fence and leaves everything else alone", () => {
    expect(unwrapFence("```tsx\nconst a = 1;\n```")).toBe("const a = 1;");
    expect(unwrapFence("const a = 1;\n")).toBe("const a = 1;\n");
    expect(unwrapFence("const md = `\n```\n`;")).toBe("const md = `\n```\n`;");
  });
});

describe("buildPullRequest", () => {
  const facts: PullRequestFacts = {
    task: "Find a winter jacket and add it to cart",
    siteUrl: "https://shop.example/",
    finding: {
      findingId: "f13",
      category: "dead_click",
      summary: 'Clicked "Add to cart" and nothing happened: no navigation, no DOM change.',
      whyItMatters: "The button ignores the click while no size is selected.",
      recommendation: "Say what is missing.",
      stepNumber: 8,
      hitCount: 3,
      url: "https://shop.example/products/parka",
    },
    fix: {
      summary: "Shows \"Please select a size\" when Add to cart is pressed with no size chosen.",
      patchJs: "try { void 0; } catch (e) {}",
      sourceFile: "src/components/ProductForm.tsx",
      before: { outcome: "timeout", steps: 13, durationMs: 61_000 },
      after: { outcome: "success", steps: 4, durationMs: 19_500 },
    },
    evidenceUrl: "https://worker.example/api/evidence/runs/r_1/primary/0008.jpg",
    primaryReplayUrl: "https://www.browserbase.com/sessions/aaa",
    verifyReplayUrl: "https://www.browserbase.com/sessions/bbb",
  };

  it("titles it Fix: <finding summary>", () => {
    expect(buildPullRequest(facts).title).toBe('Fix: Clicked "Add to cart" and nothing happened: no navigation, no DOM change');
    expect(pullRequestTitle("x".repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it("says what the agent tried, what went wrong at which step, and how often", () => {
    const { body } = buildPullRequest(facts);
    expect(body).toContain("> Find a winter jacket and add it to cart");
    expect(body).toContain("at step 8");
    expect(body).toContain("hit it 3 times in one run");
  });

  it("states the verification concretely, and exactly what was and was not verified", () => {
    const { body } = buildPullRequest(facts);
    expect(body).toContain("Verified: the agent completed the task in 4 steps, down from 13 steps and a timeout, with the fix applied.");
    expect(body).toContain("has not itself been run");
    expect(body).toMatch(/\| Before \| timeout \| 13 \| 61\.0s \|/);
  });

  it("links the evidence screenshot and BOTH session replays", () => {
    const { body } = buildPullRequest(facts);
    expect(body).toContain(facts.evidenceUrl);
    expect(body).toContain("https://www.browserbase.com/sessions/aaa");
    expect(body).toContain("https://www.browserbase.com/sessions/bbb");
    expect(buildPullRequest({ ...facts, verifyReplayUrl: null }).body).toContain("after (verification run): not recorded");
  });
});

describe("fixBranchName", () => {
  it("is friction/fix-<findingId>, git-safe", () => {
    expect(fixBranchName("f13")).toBe("friction/fix-f13");
    expect(fixBranchName("f13", "r_ab12")).toBe("friction/fix-f13-r_ab12");
    expect(fixBranchName("a b..c")).toBe("friction/fix-a-b.c");
  });
});
