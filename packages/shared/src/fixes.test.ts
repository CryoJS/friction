/**
 * The pure rules behind fix verification and pull requests.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PATCH_LINES,
  checkGeneratedFile,
  describeComparison,
  guardPatch,
  describeNotSelected,
  judgeVerification,
  patchSearchTerms,
  planRetries,
  planVerification,
  routeHits,
  routeSearchTerms,
  visibleTextTerms,
  rankSearchHits,
  searchTermsFor,
  selectTopFindings,
  unwrapFence,
  buildPullRequest,
  fixBranchName,
  pullRequestTitle,
  validatePatch,
  type PullRequestFacts,
  type SelectableFinding,
  type Verdict,
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

describe("planVerification", () => {
  const f = (findingId: string, category: SelectableFinding["category"], severity: number, confidence: number, selector = "", url = "https://shop.example/collections/mens"): SelectableFinding => ({
    findingId,
    category,
    severity,
    confidence,
    hitCount: 1,
    selector,
    url,
  });

  it("verifies the dead_click (sev 3) before the step_budget (sev 4): causes before symptoms", () => {
    const plan = planVerification([f("f18", "step_budget", 4, 0.9), f("f10", "dead_click", 3, 0.98, "xpath=/html[1]/body[1]/main[1]/div[3]/div[1]/button[2]")], 2);
    expect(plan.selected.map((x) => x.findingId)).toEqual(["f10", "f18"]);
    expect(planVerification([f("f18", "step_budget", 4, 0.9), f("f10", "dead_click", 3, 0.98, "button#a")], 1).selected.map((x) => x.findingId)).toEqual(["f10"]);
  });

  it("two findings on one selector verify once: the higher-ranked fixable one", () => {
    // Scan s_7oqpezr9mf task 2: dead_click and ambiguous_label on the same wishlist button.
    const button = "xpath=/html[1]/body[1]/main[1]/div[3]/article[1]/button[2]";
    const plan = planVerification([f("f9", "ambiguous_label", 3, 0.98, button), f("f7", "dead_click", 4, 0.94, button), f("f14", "loop", 4, 0.97, "xpath=/html[1]/body[1]/main[1]/div[3]/article[1]/a[1]")], 3);
    expect(plan.selected.map((x) => x.findingId)).toEqual(["f7", "f14"]);
    expect(plan.notSelected).toEqual([{ finding: expect.objectContaining({ findingId: "f9" }), why: "same_cause", sameCauseAs: "f7" }]);
  });

  it("a symptom on the fixable finding's element is the same cause, whatever its severity", () => {
    // Scan s_t9bui7z4uw task 5: loop sev 4 and dead_click sev 3, both on the search input.
    const input = "xpath=/html[1]/body[1]/header[1]/form[1]/input[1]";
    const plan = planVerification([f("f23", "loop", 4, 0.87, input), f("f8", "dead_click", 3, 0.91, input), f("f20", "step_budget", 3, 0.77)], 3);
    expect(plan.selected.map((x) => x.findingId)).toEqual(["f8", "f20"]);
    expect(plan.notSelected[0]).toMatchObject({ why: "same_cause", sameCauseAs: "f8" });
  });

  it("the same structural xpath on another page is another element, and findings with no element are never merged", () => {
    const xpath = "xpath=/html[1]/body[1]/main[1]/div[3]/article[1]/a[1]";
    const plan = planVerification(
      [f("a", "dead_click", 3, 0.9, xpath, "https://shop.example/collections/mens/"), f("b", "dead_click", 3, 0.8, xpath, "https://shop.example/collections/womens"), f("c", "loop", 3, 0.9), f("d", "step_budget", 3, 0.8)],
      5,
    );
    expect(plan.selected.map((x) => x.findingId)).toEqual(["a", "b", "c", "d"]);
  });

  it("says why the rest were not selected", () => {
    const plan = planVerification([f("a", "dead_click", 5, 0.9, "#a"), f("b", "retry", 4, 0.9, "#b"), f("c", "error_text", 3, 0.9, "#c"), f("d", "loop", 5, 0.99)], 2);
    expect(plan.selected.map((x) => x.findingId)).toEqual(["a", "b"]);
    expect(plan.notSelected.map((x) => [x.finding.findingId, x.why])).toEqual([
      ["c", "below_cut"],
      ["d", "symptom"],
    ]);
    expect(describeNotSelected(plan.notSelected[1]!, "loop")).toMatch(/loop is a symptom/);
    expect(describeNotSelected({ why: "same_cause", sameCauseAs: "f7" }, "ambiguous_label")).toMatch(/same element as f7/);
    expect(planVerification([f("a", "dead_click", 5, 0.9)], 0).selected).toEqual([]);
  });
});

describe("planRetries", () => {
  const verdict = (reason: Verdict["reason"], stage: Verdict["stage"] = "rejected"): Verdict => ({ stage, reason, note: "" });
  const attempt = (findingId: string, category: SelectableFinding["category"], v: Verdict, attempts = 1) => ({ findingId, category, verdict: v, attempts });

  it("retries a fixable finding whose patch ran and whose category still fires", () => {
    expect(planRetries([attempt("f10", "dead_click", verdict("still_fires"))], { used: 1, maxRuns: 4 })).toEqual(["f10"]);
  });

  it("never retries a symptom, a verified fix, a run that proved nothing, or a second time", () => {
    const attempts = [
      attempt("a", "loop", verdict("still_fires")),
      attempt("b", "dead_click", verdict("no_longer_fires", "verified")),
      attempt("c", "dead_click", verdict("patch_inactive")),
      attempt("d", "dead_click", verdict("errored")),
      attempt("e", "dead_click", verdict("not_reached")),
      attempt("f", "dead_click", verdict("still_fires"), 2),
    ];
    expect(planRetries(attempts, { used: 0, maxRuns: 10 })).toEqual([]);
  });

  it("a retry never exceeds the cap", () => {
    const three = ["a", "b", "c"].map((id) => attempt(id, "dead_click", verdict("still_fires")));
    expect(planRetries(three, { used: 3, maxRuns: 4 })).toEqual(["a"]);
    expect(planRetries(three, { used: 4, maxRuns: 4 })).toEqual([]);
    expect(planRetries(three, { used: 5, maxRuns: 4 })).toEqual([]);
    for (let used = 0; used <= 6; used++) expect(used + planRetries(three, { used, maxRuns: 4 }).length).toBeLessThanOrEqual(Math.max(used, 4));
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

describe("judgeVerification, from the rejections of three live scans (2026-09-19)", () => {
  const lane = (outcome: "success" | "failure" | "timeout", steps: number) => ({ outcome, steps, durationMs: 1 });
  const seen = (result: ReturnType<typeof lane>, over: Partial<VerifyObservation> = {}): VerifyObservation => ({ result, errored: false, patchActive: true, categoryHits: 0, reachedFindingPage: false, ...over });

  it("2 steps, down from 15: the fix removed the need to reach the page, so it is verified, and the note has both numbers", () => {
    for (const category of ["step_budget", "retry"] as const) {
      const verdict = judgeVerification({ category, before: lane("success", 15), after: seen(lane("success", 2)), categoryHitsBefore: 1 });
      expect(verdict).toMatchObject({ stage: "verified", reason: "fewer_steps" });
      expect(verdict.note).toBe(`With the fix, the agent completed the task in 2 steps, down from 15 steps; ${category} no longer needed to be passed.`);
    }
  });

  it("15 steps and a timeout, against 15 steps and a timeout: never reached, nothing better, rejected", () => {
    const verdict = judgeVerification({ category: "ambiguous_label", before: lane("timeout", 15), after: seen(lane("timeout", 15)), categoryHitsBefore: 1 });
    expect(verdict).toMatchObject({ stage: "rejected", reason: "not_reached" });
    expect(verdict.note).toMatch(/never reached the page where ambiguous_label happened/);
  });

  it("gave up after 8 steps, down from 15 and giving up: giving up sooner is not an improvement", () => {
    expect(judgeVerification({ category: "loop", before: lane("failure", 15), after: seen(lane("failure", 8)), categoryHitsBefore: 1 })).toMatchObject({ stage: "rejected", reason: "not_reached" });
  });

  it("a worse outcome is rejected however few steps it took", () => {
    // "dead_click still fires (1 time); the agent gave up after 8 steps, down from 15 steps."
    expect(judgeVerification({ category: "dead_click", before: lane("success", 15), after: seen(lane("failure", 8), { categoryHits: 1, reachedFindingPage: true }), categoryHitsBefore: 1 }).stage).toBe("rejected");
    expect(judgeVerification({ category: "dead_click", before: lane("success", 15), after: seen(lane("failure", 2)), categoryHitsBefore: 1 }).stage).toBe("rejected");
  });

  it("a category that went quiet because the task broke is not a fix", () => {
    // Was verified before this rule: "loop no longer fires; the agent gave up after 9 steps, down from 14 steps." The primary run had completed the task.
    const verdict = judgeVerification({ category: "loop", before: lane("success", 14), after: seen(lane("failure", 9), { reachedFindingPage: true }), categoryHitsBefore: 2 });
    expect(verdict).toMatchObject({ stage: "rejected", reason: "outcome_worse" });
    expect(verdict.note).toBe("loop no longer fires, but with the fix the agent no longer completed the task: it gave up after 9 steps, down from 14 steps.");
    // Failing both times is not worse: the category going quiet still counts.
    expect(judgeVerification({ category: "loop", before: lane("timeout", 15), after: seen(lane("failure", 9), { reachedFindingPage: true }) })).toMatchObject({ stage: "verified", reason: "no_longer_fires" });
  });

  it("running out of steps where the primary run barely finished is variance at the cap, not the fix breaking the task", () => {
    // Live scan, rejected by the first version of the rule: "modal_interrupt no longer fires, but with the fix the agent
    // no longer completed the task: it timed out after 15 steps, compared with 15 steps." The same for a dead_click.
    for (const category of ["modal_interrupt", "dead_click"] as const) {
      const verdict = judgeVerification({ category, before: lane("success", 15), after: seen(lane("timeout", 15), { reachedFindingPage: true }), categoryHitsBefore: 1 });
      expect(verdict).toMatchObject({ stage: "verified", reason: "no_longer_fires" });
      expect(verdict.note).toBe(
        `${category} no longer fires; the agent timed out after 15 steps, compared with 15 steps. The primary run only finished on its last steps (15), so running out of steps is not held against the fix.`,
      );
    }
    expect(judgeVerification({ category: "dead_click", before: lane("success", 14), after: seen(lane("timeout", 15), { reachedFindingPage: true }) }).stage).toBe("verified");
    // With steps to spare before, running out of them now IS worse; so is giving up, at any count.
    expect(judgeVerification({ category: "dead_click", before: lane("success", 6), after: seen(lane("timeout", 15), { reachedFindingPage: true }) })).toMatchObject({ stage: "rejected", reason: "outcome_worse" });
    expect(judgeVerification({ category: "dead_click", before: lane("success", 15), after: seen(lane("failure", 15), { reachedFindingPage: true }) })).toMatchObject({ stage: "rejected", reason: "outcome_worse" });
    // It never rescues a category that still fires, or a run that never reached the page.
    expect(judgeVerification({ category: "dead_click", before: lane("success", 15), after: seen(lane("timeout", 15), { categoryHits: 1, reachedFindingPage: true }), categoryHitsBefore: 1 }).stage).toBe("rejected");
    expect(judgeVerification({ category: "dead_click", before: lane("success", 15), after: seen(lane("timeout", 15)) }).stage).toBe("rejected");
  });

  it("fewer hits AND clearly fewer steps is verified; the same hits, or a step of variance, is not", () => {
    const fewer = judgeVerification({ category: "dead_click", before: lane("success", 15), after: seen(lane("success", 6), { categoryHits: 1, reachedFindingPage: true }), categoryHitsBefore: 3 });
    expect(fewer).toMatchObject({ stage: "verified", reason: "fewer_steps" });
    expect(fewer.note).toBe("With the fix, the agent completed the task in 6 steps, down from 15 steps; dead_click fired 1 time, down from 3 times.");
    // "long_wait still fires (1 time); the agent completed the task in 2 steps, down from 5 steps.": as many hits as before.
    expect(judgeVerification({ category: "long_wait", before: lane("success", 5), after: seen(lane("success", 2), { categoryHits: 1, reachedFindingPage: true }), categoryHitsBefore: 1 })).toMatchObject({ stage: "rejected", reason: "still_fires" });
    // "dead_click still fires (2 times); the agent completed the task in 4 steps, down from 5 steps."
    expect(judgeVerification({ category: "dead_click", before: lane("success", 5), after: seen(lane("success", 4), { categoryHits: 2, reachedFindingPage: true }), categoryHitsBefore: 1 }).stage).toBe("rejected");
    // "loop still fires (2 times); the agent completed the task in 14 steps, down from 15 steps."
    expect(judgeVerification({ category: "loop", before: lane("success", 15), after: seen(lane("success", 14), { categoryHits: 2, reachedFindingPage: true }), categoryHitsBefore: 1 }).stage).toBe("rejected");
    // Without the primary run's hit count, fewer hits cannot be claimed.
    expect(judgeVerification({ category: "dead_click", before: lane("success", 15), after: seen(lane("success", 6), { categoryHits: 1, reachedFindingPage: true }) }).stage).toBe("rejected");
  });

  it("the step drop must be at least 2 and at least 30%", () => {
    const judge = (beforeSteps: number, afterSteps: number) => judgeVerification({ category: "retry", before: lane("success", beforeSteps), after: seen(lane("success", afterSteps)) }).stage;
    expect(judge(15, 11)).toBe("rejected"); // 27%
    expect(judge(15, 10)).toBe("verified"); // 33%
    expect(judge(3, 2)).toBe("rejected"); // 33%, but one step
    expect(judge(4, 2)).toBe("verified");
    expect(judge(9, 9)).toBe("rejected");
  });

  it("no change from before, an errored run and an inactive patch are still rejected", () => {
    expect(judgeVerification({ category: "step_budget", before: lane("success", 15), after: seen(lane("success", 15), { categoryHits: 1, reachedFindingPage: true }), categoryHitsBefore: 1 }).note).toMatch(/no change from before/);
    expect(judgeVerification({ category: "retry", before: lane("success", 15), after: seen(lane("success", 2), { errored: true }) })).toMatchObject({ stage: "rejected", reason: "errored" });
    expect(judgeVerification({ category: "retry", before: lane("success", 15), after: seen(lane("success", 2), { patchActive: false }) })).toMatchObject({ stage: "rejected", reason: "patch_inactive" });
  });

  it("the golden run's verdicts stand: f13 verified, f15 rejected", () => {
    const before = { outcome: "failure" as const, steps: 14, durationMs: 55_230 };
    expect(judgeVerification({ category: "dead_click", before, after: seen({ outcome: "success", steps: 11, durationMs: 48_160 }, { reachedFindingPage: true }), categoryHitsBefore: 2 })).toMatchObject({ stage: "verified", reason: "outcome_improved" });
    const f15 = judgeVerification({ category: "retry", before, after: seen({ outcome: "timeout", steps: 15, durationMs: 58_380 }, { categoryHits: 2, reachedFindingPage: true }), categoryHitsBefore: 2 });
    expect(f15).toMatchObject({ stage: "rejected", reason: "still_fires" });
    expect(f15.note).toBe("retry still fires (2 times); the agent timed out after 15 steps, up from 14 steps and giving up.");
  });
});

describe("mapping fallbacks", () => {
  it("reads the selectors a verified patch looked its element up with", () => {
    const patch = [
      "try {",
      "  document.addEventListener('click', (e) => {",
      "    const a = e.target.closest('a');",
      '    const card = e.target.closest("[data-product-card]");',
      "    const button = document.querySelector('button.wishlist-toggle, #wishlist-count');",
      "    if (card.matches(`[aria-label=\"Add to wishlist\"]`)) document.getElementById('size-error').hidden = false;",
      "    document.querySelector(name);",
      "  }, true);",
      "} catch (e) {}",
    ].join("\n");
    expect(patchSearchTerms(patch)).toEqual(["data-product-card", "wishlist-toggle", "wishlist-count", "Add to wishlist", "size-error"]);
    expect(patchSearchTerms("try { document.body.click(); } catch (e) {}")).toEqual([]);
  });

  it("breaks a rendered label into the parts a template would hold", () => {
    expect(visibleTextTerms(["Add to wishlist: Alpine Down Parka"])).toEqual(["Add to wishlist", "Alpine Down Parka", "Add to", "Alpine Down"]);
    expect(visibleTextTerms(["Add Alpine Down Parka to cart"])).toEqual(["Add Alpine Down", "Add Alpine"]);
    expect(visibleTextTerms(["Search", ""])).toEqual([]);
  });

  it("turns the finding's route into path terms", () => {
    expect(routeSearchTerms("https://shop.example/products/alpine-parka?size=m#top")).toEqual(["products", "alpine-parka"]);
    expect(routeSearchTerms("https://shop.example/collections/mens-jackets/")).toEqual(["collections", "mens-jackets"]);
    expect(routeSearchTerms("https://shop.example/")).toEqual(["index"]);
    expect(routeSearchTerms("https://shop.example/about.html")).toEqual(["about"]);
    expect(routeSearchTerms("not a url")).toEqual([]);
  });

  it("matches route terms against file paths under a routes directory only, and the hits are ranked like any other", () => {
    const paths = ["src/pages/products/[slug].astro", "src/pages/index.astro", "src/components/products/Grid.astro", "app/products/page.tsx", "routes/products.test.ts", "README.md", ".github/workflows/products.yml"];
    const hits = routeHits(paths, ["products", "alpine-parka"]);
    expect(hits.map((h) => h.path)).toEqual(["src/pages/products/[slug].astro", "app/products/page.tsx", "routes/products.test.ts"]);
    expect(rankSearchHits(hits, ["products", "alpine-parka"]).map((h) => h.path)).toEqual(["app/products/page.tsx", "src/pages/products/[slug].astro"]);
    expect(routeHits(paths, ["index"]).map((h) => h.path)).toEqual(["src/pages/index.astro"]);
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
