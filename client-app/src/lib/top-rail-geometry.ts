/**
 * When the floating top rail hides and comes back, off a scroller's offsets.
 *
 * Pure and a worklet, so `useScreenScroll` runs it on the UI thread and
 * `top-rail-geometry.test.ts` runs it under `node --test`.
 */

/** Matches the `h-14` row of `TopRail`. */
export const TOP_RAIL_HEIGHT = 56;

/**
 * Space between a floating rail and the first thing on the page under it. One
 * value for every page, so they all sit the same distance below the rail.
 */
export const RAIL_CONTENT_GAP = 16;

/** Within this of the top, the page counts as at the top. */
const AT_TOP = 4;

/**
 * The rail's next target, 1 shown and 0 hidden, after the scroller moved from
 * `previous` to `offset`, the scroller's own offsets. 0 is the page at rest,
 * its first content sitting just under the rail.
 *
 * Hides on a scroll down off the top and only comes back at the top, never on
 * a scroll up partway down. The bounce past the top counts as the top.
 */
export function nextRailShown(
    shown: number,
    previous: number,
    offset: number,
): number {
    "worklet";
    if (offset <= AT_TOP) return 1;
    if (offset > previous) return 0;
    return shown;
}
