/**
 * Bumped whenever the overlay's rendering or resolution changes. Served with
 * every annotations response so a panel drawn by an older bookmarklet can
 * tell the user to re-drag it.
 *
 * Kept in its own zod-free module, deliberately separate from anchor.ts.
 * packages/overlay's bookmarklet needs this single number at runtime and
 * nothing else from this package; anchor.ts imports `zod` for AnchorSchema,
 * and `z.object(...)`'s argument is a plain object literal full of unannotated
 * nested `z.string()`/`z.number()`/`z.record()` calls, none of which esbuild
 * can prove side-effect-free, so it can never fully tree-shake AnchorSchema
 * away even when unused -- importing OVERLAY_VERSION from anchor.ts would
 * drag the entire ~450KB zod runtime into a bundle whose whole budget is
 * 25KB. Living here instead, the bookmarklet's build can import this value
 * without ever touching anchor.ts's module graph.
 */
export const OVERLAY_VERSION = 1;
