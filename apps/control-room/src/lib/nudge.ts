/**
 * Prototype: task and issue nodes lean away from the cursor and spring back,
 * like a light magnetic field -- a first pass at "physics" on top of the
 * scan graph's fixed orbit layout (see scanLayout.ts).
 *
 * Runs entirely in flow (React Flow) coordinate space, the same space as
 * every position and radius in scanLayout.ts, rather than screen pixels --
 * so the effect reads the same size at any zoom level. ScanGraph converts
 * the cursor's screen position to flow coordinates once per frame
 * (screenToFlowPosition) and writes the result straight onto each node's
 * real `position`, which is what makes the connecting edges -- derived by
 * React Flow from node position and handle offsets, never from a live DOM
 * transform -- move together with the node instead of staying pinned to
 * its rest position.
 *
 * The spring state (below) is one module-level map, not React state: it
 * needs to survive 60-times-a-second updates without round-tripping through
 * a re-render, and the app only ever shows one scan graph at a time.
 */

const REPEL_RADIUS = 320;
const MAX_OFFSET = 14;
const SPRING = 0.22;
/**
 * Issue satellites lean away less than tasks: both how close the cursor has
 * to get before one budges (its own share of REPEL_RADIUS) and how far it
 * budges at most (its own share of MAX_OFFSET) are scaled down by this,
 * while the spring itself (SPRING) is untouched, so a nudged issue still
 * eases in and out at the same rate a task does -- it just travels less.
 */
const ISSUE_SENSITIVITY = 0.5;
/** Below this the spring counts as settled: the result reports exactly zero, so its node lands precisely back on its rest position instead of drifting by a fraction of a pixel forever. */
const SETTLE_EPSILON = 0.05;

export interface NudgeTarget {
  id: string;
  kind: "task" | "issue";
  /** the node's rest centre, in flow coordinates (its layout position + half its own size). */
  cx: number;
  cy: number;
}

export interface NudgeResult {
  /** the offset to add to the node's rest position, in flow units; exactly {0, 0} once settled. */
  dx: number;
  dy: number;
  /** true while displaced or still springing back -- callers should turn off any CSS position transition while true, so this spring (not a slower layout transition) drives the motion. */
  active: boolean;
}

const state = new Map<string, { ox: number; oy: number }>();

/** Advances every target's spring by one frame toward "away from cursorFlow" (or back to rest if cursorFlow is null -- the pointer is outside the canvas). Always returns one result per target. */
export function stepNudge(targets: readonly NudgeTarget[], cursorFlow: { x: number; y: number } | null): Map<string, NudgeResult> {
  const results = new Map<string, NudgeResult>();
  for (const target of targets) {
    let spring = state.get(target.id);
    if (!spring) {
      spring = { ox: 0, oy: 0 };
      state.set(target.id, spring);
    }
    const scale = target.kind === "issue" ? ISSUE_SENSITIVITY : 1;
    const repelRadius = REPEL_RADIUS * scale;
    const maxOffset = MAX_OFFSET * scale;
    let tx = 0;
    let ty = 0;
    if (cursorFlow) {
      const dx = target.cx - cursorFlow.x;
      const dy = target.cy - cursorFlow.y;
      const dist = Math.hypot(dx, dy);
      if (dist < repelRadius && dist > 0.01) {
        const strength = (1 - dist / repelRadius) * maxOffset;
        tx = (dx / dist) * strength;
        ty = (dy / dist) * strength;
      }
    }
    spring.ox += (tx - spring.ox) * SPRING;
    spring.oy += (ty - spring.oy) * SPRING;
    const active = tx !== 0 || ty !== 0 || Math.abs(spring.ox) > SETTLE_EPSILON || Math.abs(spring.oy) > SETTLE_EPSILON;
    if (active) {
      results.set(target.id, { dx: spring.ox, dy: spring.oy, active: true });
    } else {
      spring.ox = 0;
      spring.oy = 0;
      results.set(target.id, { dx: 0, dy: 0, active: false });
    }
  }
  return results;
}

/** Drops a node's spring state entirely -- call when the graph unmounts, so a later scan starts fresh. */
export function clearAllNudge(): void {
  state.clear();
}

export function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
