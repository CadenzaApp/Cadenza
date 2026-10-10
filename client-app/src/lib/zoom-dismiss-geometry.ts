/** Pull distance that commits a pushed screen dismissal. */
export const ZOOM_DISMISS_PULL = 110;
/** Full close duration when no interactive progress has already been made. */
export const ZOOM_CLOSE_DURATION = 280;
/** Open duration from the recorded artwork to the full screen. */
export const ZOOM_OPEN_DURATION = 320;

const PULL_PROGRESS_PER_POINT = 0.002;
const MAX_INTERACTIVE_PROGRESS = 0.96;
const MIN_CLOSE_DURATION = 16;
const FALLBACK_SCALE = 0.7;
const FULL_VISIBLE_RADIUS = 52;
const MAX_TARGET_VISIBLE_RADIUS = 40;
const TARGET_RADIUS_RATIO = 0.24;

export type ZoomRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ZoomFrame = {
    /** The page's scale, from its top-left corner. */
    scale: number;
    /** Where the page's top-left corner sits on screen. */
    translateX: number;
    translateY: number;
    /** The card's corner radius as seen on screen, before the scale. */
    visibleRadius: number;
    /** The same radius inside the scaled card, so it shows as `visibleRadius`. */
    borderRadius: number;
}; /** Maps iOS overscroll to interactive transition progress. */
export function zoomProgressForScrollOffset(offsetY: number): number {
    "worklet";
    return Math.min(
        Math.max(Math.max(0, -offsetY) * PULL_PROGRESS_PER_POINT, 0),
        MAX_INTERACTIVE_PROGRESS,
    );
}

/** Whether releasing at this offset should finish the dismissal. */
export function shouldDismissZoom(offsetY: number): boolean {
    "worklet";
    return offsetY <= -ZOOM_DISMISS_PULL;
}

/** Keeps the remaining animation speed consistent after an interactive pull. */
export function zoomCloseDuration(progress: number): number {
    "worklet";
    const boundedProgress = Math.min(Math.max(progress, 0), 1);
    const remaining = 1 - boundedProgress;
    return Math.max(
        MIN_CLOSE_DURATION,
        Math.round(ZOOM_CLOSE_DURATION * remaining),
    );
}

// Defined before the worklets that use them: Reanimated's plugin turns each
// worklet into a value captured where it is declared, so a helper declared
// further down is still undefined when zoomFrame captures it.
function lerp(from: number, to: number, t: number) {
    "worklet";
    return from + (to - from) * t;
}

/** Where a close with nothing recorded lands: a square, centered. */
function centeredSquare(width: number, height: number): ZoomRect {
    "worklet";
    const size = width * FALLBACK_SCALE;
    return {
        x: (width - size) / 2,
        y: (height - size) / 2,
        width: size,
        height: size,
    };
}

/** The artwork to land on the tile, or the top of the page without one. */
export function visibleFocus(
    viewportWidth: number,
    viewportHeight: number,
    focus: ZoomRect | null,
): ZoomRect {
    "worklet";
    return focus &&
        focus.width > 0 &&
        focus.height > 0 &&
        focus.y + focus.height > 0 &&
        focus.y < viewportHeight
        ? focus
        : { x: 0, y: 0, width: viewportWidth, height: viewportWidth };
}

/** Share of the close over which the page fades, leaving the artwork. */
export const ZOOM_PAGE_FADE_SHARE = 0.35;

/**
 * The card at one point of the close, 0 the full screen and 1 sitting on the
 * tile it opened from. The open is the same frames run backwards.
 *
 * The page moves and scales as one piece, transforms only, so the artwork on
 * it (`focus`, where it sits while the card is full size) lands exactly on
 * the tile. The page itself fades out early (`pageOpacity`), leaving a copy of
 * the artwork that rides the same transform: the close reads as the artwork
 * shrinking back into its tile, the way Apple Music closes an album.
 *
 * With no artwork, or it scrolled out of sight, the top of the page stands in
 * for it. `origin` null means nothing was recorded, so the card closes to a
 * square in the middle of the screen.
 */
export function zoomFrame(
    viewportWidth: number,
    viewportHeight: number,
    origin: ZoomRect | null,
    focus: ZoomRect | null,
    progress: number,
): ZoomFrame {
    "worklet";
    // eased by the timing that drives it, so linear here
    const p = Math.min(Math.max(progress, 0), 1);
    const target = origin ?? centeredSquare(viewportWidth, viewportHeight);
    const art = visibleFocus(viewportWidth, viewportHeight, focus);

    const endScale = target.width / art.width;
    const scale = lerp(1, endScale, p);
    const visibleRadius = lerp(
        FULL_VISIBLE_RADIUS,
        Math.min(MAX_TARGET_VISIBLE_RADIUS, target.width * TARGET_RADIUS_RATIO),
        p,
    );
    return {
        scale,
        translateX: lerp(0, target.x - art.x * endScale, p),
        translateY: lerp(0, target.y - art.y * endScale, p),
        visibleRadius,
        borderRadius: visibleRadius / scale,
    };
}

/** The page's opacity at this point of the close, when an artwork copy is shown. */
export function zoomPageOpacity(progress: number): number {
    "worklet";
    return 1 - Math.min(Math.max(progress / ZOOM_PAGE_FADE_SHARE, 0), 1);
}
