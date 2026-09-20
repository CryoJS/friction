/**
 * The regression test a pull request ships with: what may be in one, where it
 * may go, and that nothing in it can become code.
 */
import { describe, expect, it } from "vitest";
import { FixTestSchema, buildTaskPullRequest, committablePathProblem, fixTestPath, isFrictionTestPath, renderPlaywrightSpec, type FixTest, type TaskPullRequestFacts } from "./index";

const PATCH = 'try { document.addEventListener("click", function () {}, true); } catch (e) {}';
const sizeTest: FixTest = {
  title: "Add to cart says a size is needed",
  startPath: "/products/alpine-down-parka",
  steps: [{ action: "click", role: "button", name: "Add to cart" }],
  expect: [{ kind: "text_visible", text: "Please select a size" }],
};
const render = (test: FixTest, patchJs = PATCH): string => renderPlaywrightSpec({ test, siteUrl: "https://shop.example/", findingId: "f13", summary: 'Clicked "Add to cart" and nothing happened.', patchJs });

/** Runs a rendered spec against a fake Playwright, recording every call: what the spec DOES, not what it looks like. */
async function execute(spec: string, env: Record<string, string> = {}): Promise<{ calls: string[]; title: string }> {
  const calls: string[] = [];
  const locator = (how: string) => ({
    first: () => locator(how),
    click: async () => void calls.push(`click ${how}`),
    fill: async (value: string) => void calls.push(`fill ${how} = ${value}`),
    __how: how,
  });
  const page = {
    goto: async (url: string) => void calls.push(`goto ${url}`),
    addInitScript: async () => void calls.push("addInitScript"),
    waitForTimeout: async (ms: number) => void calls.push(`wait ${ms}`),
    keyboard: { press: async (key: string) => void calls.push(`press ${JSON.stringify(key)}`) },
    getByRole: (role: string, options: { name: string }) => locator(`role=${role}[${options.name}]`),
    getByText: (text: string) => locator(`text=${text}`),
    url: () => "https://shop.example/cart",
  };
  const expectFn = Object.assign(
    (subject: { __how?: string }) => ({ toBeVisible: async () => void calls.push(`visible ${subject.__how}`), toBeHidden: async () => void calls.push(`hidden ${subject.__how}`) }),
    { poll: () => ({ toContain: async (value: string) => void calls.push(`url contains ${value}`) }) },
  );
  let title = "";
  let body: ((fixtures: { page: typeof page }) => Promise<void>) | null = null;
  const test = (name: string, fn: typeof body): void => {
    title = name;
    body = fn;
  };
  const source = spec.replace(/^import .*$/m, "");
  new Function("test", "expect", "process", source)(test, expectFn, { env });
  await body!({ page });
  return { calls, title };
}

describe("FixTestSchema", () => {
  it("accepts steps by role and name, and expectations a visitor could check", () => {
    expect(FixTestSchema.safeParse(sizeTest).success).toBe(true);
  });

  it("only ever stays on the scanned site: a path, never a URL", () => {
    for (const startPath of ["https://evil.example/", "//evil.example/x", "javascript:alert(1)", "products/x", ""]) expect(FixTestSchema.safeParse({ ...sizeTest, startPath }).success, startPath).toBe(false);
    expect(FixTestSchema.safeParse({ ...sizeTest, steps: [{ action: "goto", path: "//evil.example" }] }).success).toBe(false);
  });

  it("needs something to assert, and bounds everything", () => {
    expect(FixTestSchema.safeParse({ ...sizeTest, expect: [] }).success).toBe(false);
    expect(FixTestSchema.safeParse({ ...sizeTest, steps: Array.from({ length: 9 }, () => sizeTest.steps[0]) }).success).toBe(false);
    expect(FixTestSchema.safeParse({ ...sizeTest, steps: [{ action: "click", role: "banner", name: "x" }] }).success).toBe(false);
    expect(FixTestSchema.safeParse({ ...sizeTest, steps: [{ action: "wait", ms: 60_000 }] }).success).toBe(false);
    expect(FixTestSchema.safeParse({ ...sizeTest, steps: [{ action: "evaluate", script: "1" }] }).success).toBe(false);
  });
});

describe("renderPlaywrightSpec", () => {
  it("renders a spec that does exactly the steps, then the expectations", async () => {
    const spec = render({
      title: "The signup popup no longer covers the product",
      startPath: "/products/glacier-3-in-1-jacket",
      steps: [{ action: "wait", ms: 4000 }, { action: "fill", role: "textbox", name: "Search products", value: "parka" }, { action: "press", key: "Enter" }, { action: "goto", path: "/cart" }],
      expect: [{ kind: "text_hidden", text: "Get 10% off your first order" }, { kind: "role_visible", role: "link", name: "View cart" }, { kind: "url_contains", value: "/cart" }],
    });
    const { calls, title } = await execute(spec);
    expect(title).toBe("The signup popup no longer covers the product");
    expect(calls).toEqual([
      "goto https://shop.example/products/glacier-3-in-1-jacket",
      "wait 4000",
      "fill role=textbox[Search products] = parka",
      'press "Enter"',
      "goto https://shop.example/cart",
      "hidden text=Get 10% off your first order",
      "visible role=link[View cart]",
      "url contains /cart",
    ]);
  });

  it("installs the runtime patch only when asked, and BASE_URL points it at a build", async () => {
    expect((await execute(render(sizeTest))).calls).not.toContain("addInitScript");
    expect((await execute(render(sizeTest), { FRICTION_RUNTIME_PATCH: "1" })).calls[0]).toBe("addInitScript");
    expect((await execute(render(sizeTest), { BASE_URL: "http://localhost:4321" })).calls[0]).toBe("goto http://localhost:4321/products/alpine-down-parka");
  });

  it("text from the scanned site stays data: it names an element, it never becomes code", async () => {
    const hostile = '"}); globalThis.pwned = true; ({"';
    const spec = renderPlaywrightSpec({
      test: { title: `x${hostile}`, startPath: "/p", steps: [{ action: "click", role: "button", name: `Buy ${hostile}` }, { action: "fill", role: "textbox", name: "Email", value: "`${globalThis.pwned = true}`" }], expect: [{ kind: "text_visible", text: `</script>${hostile}` }] },
      siteUrl: "https://shop.example/",
      findingId: "f1\n*/ globalThis.pwned = true; /*",
      summary: "line one\nglobalThis.pwned = true; // */",
      patchJs: "try { } catch (e) {} `; globalThis.pwned = true; `",
    });
    const { calls } = await execute(spec);
    expect((globalThis as { pwned?: boolean }).pwned).toBeUndefined();
    expect(calls).toContain(`click role=button[Buy ${hostile}]`);
    expect(calls).toContain("fill role=textbox[Email] = `${globalThis.pwned = true}`");
    // Every comment line is still a comment: nothing after the first newline of the summary escaped it.
    for (const line of spec.split("\n").slice(0, 9)) expect(line.startsWith("//")).toBe(true);
  });

  it("says what was seen and what was not", () => {
    const spec = render(sizeTest);
    expect(spec).toContain("they FAILED (the problem is real)");
    expect(spec).toContain("They have NOT been run against this pull request's source change.");
    expect(spec).toContain('import { expect, test } from "@playwright/test";');
  });
});

describe("where a regression test may go", () => {
  it("only ever a new, flat file under tests/friction/", () => {
    const path = fixTestPath("r_1rzre3gbtg", "f13");
    expect(path).toBe("tests/friction/1rzre3gbtg-f13.spec.ts");
    expect(isFrictionTestPath(path)).toBe(true);
    expect(isFrictionTestPath(fixTestPath("../../.github/workflows", "f1/../../x"))).toBe(true);
    expect(fixTestPath("../../.github/workflows", "f1/../../x")).toBe("tests/friction/github-workflows-f1-x.spec.ts");
    for (const bad of ["tests/friction/../x.spec.ts", "tests/friction/a/b.spec.ts", "tests/cart.spec.ts", ".github/workflows/x.spec.ts", "tests/friction/x.spec.js", "tests/friction/.spec.ts", "/tests/friction/x.spec.ts", "tests/friction/X.spec.ts"]) {
      expect(isFrictionTestPath(bad), bad).toBe(false);
    }
  });

  it("the source path guard still refuses every test file, this one included: a FIX can never touch tests", () => {
    expect(committablePathProblem("tests/friction/1rzre3gbtg-f13.spec.ts")).not.toBeNull();
    expect(committablePathProblem("src/cart.spec.ts")).not.toBeNull();
  });
});

describe("the pull request body", () => {
  const fix: TaskPullRequestFacts["fixes"][number] = {
    finding: { findingId: "f13", category: "dead_click", summary: 'Clicked "Add to cart" and nothing happened.', whyItMatters: "", recommendation: "", stepNumber: 8, hitCount: 1, url: "https://shop.example/products/parka" },
    fix: { summary: "Says a size is needed.", patchJs: PATCH, sourceFile: "src/ProductForm.tsx", before: { outcome: "timeout", steps: 13, durationMs: 1 }, after: { outcome: "success", steps: 4, durationMs: 1 } },
    evidenceUrl: null,
    primaryReplayUrl: null,
    verifyReplayUrl: null,
  };
  const facts = (test: TaskPullRequestFacts["fixes"][number]["test"]): TaskPullRequestFacts => ({ task: "Buy a parka.", taskIndex: 0, siteUrl: "https://shop.example/", fixes: [{ ...fix, test }], notFixed: [], alsoUnblocks: [] });

  it("names the test it adds, what was proven, and what was not", () => {
    const { body } = buildTaskPullRequest(facts({ path: "tests/friction/abc-f13.spec.ts", note: "Regression test proven in a browser: it failed against the site as it is and passed with the verified patch installed." }));
    expect(body).toContain("## Regression test");
    expect(body).toContain("This PR adds `tests/friction/abc-f13.spec.ts`");
    expect(body).toContain("It has **not** been run against this PR's source change.");
  });

  it("says why there is no test, and says nothing when none was attempted", () => {
    expect(buildTaskPullRequest(facts({ path: null, note: "No regression test: the one written passes against the site as it is, so it would prove nothing." })).body).toContain("would prove nothing");
    expect(buildTaskPullRequest(facts(undefined)).body).not.toContain("Regression test");
  });
});
