/**
 * Test-only polyfill for `document.evaluate`.
 *
 * happy-dom (through at least 20.14.5) does not implement `Document.evaluate`
 * / XPath at all -- not "reparses and drifts", simply absent, so
 * `doc.evaluate(...)` throws `TypeError: document.evaluate is not a
 * function`. `byXPath()` in ../resolve.ts already catches that and returns
 * null, which silently degrades every tier-2 test to tier 3/4/5 instead of
 * exercising the XPath-verification behavior tier 2 exists to test -- e.g.
 * "uses the XPath when role and name still match" was passing via tier 3
 * (confidence "likely") rather than tier 2 (confidence "exact").
 *
 * This is a test-environment gap, not a resolver defect: real browsers (the
 * bookmarklet's actual runtime) have supported `document.evaluate` since
 * XPath 1.0. So the fix belongs here, in the test harness, per the task's
 * instruction not to weaken the ladder to make a test pass. This polyfills
 * only the absolute-path subset actually produced by
 * apps/orchestrator/src/pageScripts.ts / Playwright's accessibility tree:
 * "/html/body[1]/div[2]/button" style paths, one plain-tag-name-with-optional
 * -index step per level, no attribute predicates or axes.
 *
 * Patched on the live `document` global directly (its own property), not on
 * a `Document` class looked up by name: happy-dom's globally-registered
 * `Document` identifier is not the same object as the actual prototype in
 * `document`'s chain (`document.constructor === Document` is false here --
 * the real chain is HTMLDocument -> HTMLDocument -> Document -> Node ->
 * EventTarget), so patching the named class silently patches nothing.
 */
function resolveAbsoluteXPath(path: string, doc: Document): Element | null {
  if (!path.startsWith("/")) return null;
  const segments = path.split("/").filter(Boolean);
  const first = segments[0];
  if (!first) return null;
  const firstMatch = /^([a-zA-Z][\w-]*)/.exec(first);
  if (!firstMatch || doc.documentElement.tagName.toLowerCase() !== firstMatch[1]!.toLowerCase()) return null;

  let node: Element = doc.documentElement;
  for (let i = 1; i < segments.length; i++) {
    const step = /^([a-zA-Z][\w-]*)(?:\[(\d+)\])?$/.exec(segments[i]!);
    if (!step) return null;
    const tag = step[1]!.toLowerCase();
    const index = step[2] ? Number.parseInt(step[2], 10) : 1; // XPath indices are 1-based
    const siblingsWithTag = [...node.children].filter((c) => c.tagName.toLowerCase() === tag);
    const next = siblingsWithTag[index - 1];
    if (!next) return null;
    node = next;
  }
  return node;
}

if (typeof document !== "undefined" && !document.evaluate) {
  (document as Document & { evaluate: Document["evaluate"] }).evaluate = function (
    this: Document,
    expression: string,
  ): XPathResult {
    const el = resolveAbsoluteXPath(expression, this);
    return { singleNodeValue: el } as XPathResult;
  };
}
