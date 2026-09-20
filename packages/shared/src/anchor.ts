/**
 * How a finding describes the element it happened on, so the annotation
 * overlay can find that element again on a later page load.
 *
 * The existing `selector` is an absolute XPath. That is enough to click
 * something mid-run and not enough to find it again days later: it encodes
 * structure, and structure is the least stable thing about a page. An Anchor
 * records identity as well, so resolution can fall back when the tree moves.
 *
 * `class` is deliberately absent. Utility CSS makes class names
 * non-distinctive and CSS-module hashing makes them change every build, so as
 * an identity signal they are worse than nothing.
 */
import { z } from "zod";

/**
 * Attributes recorded verbatim, in preference order. Interpolated into the
 * page script in apps/orchestrator/src/pageScripts.ts, so this array is the
 * single source of truth for both sides.
 */
export const ANCHOR_ATTRS = ["id", "data-testid", "data-test", "data-cy", "data-qa", "name", "type", "aria-label"] as const;

/** Extra `data-*` attributes kept beyond the named ones, to bound the payload. */
export const MAX_DATA_ATTRS = 4;

/** Longest accessible name and visible text an anchor stores. */
export const ANCHOR_NAME_MAX = 200;
export const ANCHOR_TEXT_MAX = 90;

export const AnchorSchema = z.object({
  /** Absolute XPath. Used, but never trusted on its own. */
  xpath: z.string(),
  /** "button" */
  tag: z.string(),
  /** Explicit role attribute, or the implicit role for the tag. */
  role: z.string(),
  /** Accessible name. */
  name: z.string().max(ANCHOR_NAME_MAX),
  /** Cleaned innerText. */
  text: z.string().max(ANCHOR_TEXT_MAX),
  attrs: z.record(z.string(), z.string()),
  /** Index among elements matching role + name on the page at capture time. */
  ordinal: z.number().int().nonnegative(),
  /** location.pathname when captured. */
  path: z.string(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

/**
 * A URL or bare host reduced to the form the annotations endpoint matches on:
 * lowercase, no leading "www.", no port. Junk returns "" rather than throwing,
 * because the caller is a query parameter handler, not a parser.
 */
export function normalizeHost(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
