/**
 * Does `findingUrl` (recorded on a finding at scan time) refer to the same
 * logical page as `currentUrl` (the page the overlay is mounted on)?
 *
 * Deliberately NOT `normalizeUrlForVisit` (packages/shared/src/util.ts) --
 * that comparator was written for run-time loop detection and is wrong on
 * both sides for this purpose:
 *
 *  - Too strict: it compares the query string verbatim, so a finding
 *    recorded at `?a=1` silently stops matching once a tracking parameter
 *    (utm_source, a reordered param) is appended. Being loose on the query
 *    string here is safe because resolveAnchor() is the backstop -- if the
 *    element genuinely is not on this page, the ladder returns unlocated
 *    regardless. A strict query match instead produces a silent miss with
 *    no backstop at all, which is the worse failure: the finding just loses
 *    its marker and gets misfiled as "elsewhere."
 *
 *  - Too loose: it drops the hash entirely, so a hash-routed SPA collapses
 *    "#/products/123" and "#/products/456" into the same page. resolveAnchor
 *    cannot tell those routes apart -- a structurally identical "Add to
 *    cart" button can exist on both -- so for a route hash the ladder is
 *    NOT a backstop. This comparator has to carry that weight itself, or it
 *    manufactures exactly the confidently-wrong pin the whole resolution
 *    ladder exists to prevent.
 *
 * A non-route hash (a same-page anchor like "#section-2") is not a
 * different view, so it is ignored just like the query string.
 */
export function sameLoggedPage(findingUrl: string, currentUrl: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(findingUrl);
    b = new URL(currentUrl);
  } catch {
    return false;
  }
  if (a.origin !== b.origin || a.pathname !== b.pathname) return false;

  const routeOf = (hash: string): string => (hash.startsWith("#/") ? hash : "");
  const routeA = routeOf(a.hash);
  const routeB = routeOf(b.hash);
  if (!routeA && !routeB) return true; // neither side is on a hash route -- a plain fragment (or none) never distinguishes pages.
  return routeA === routeB;
}
