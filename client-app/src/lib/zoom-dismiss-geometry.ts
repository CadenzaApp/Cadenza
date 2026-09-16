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
const MIN_SCALE = 0.12;
const FULL_VISIBLE_RADIUS = 52;
const MAX_TARGET_VISIBLE_RADIUS = 40;
const TARGET_RADIUS_RATIO = 0.24;

export type ZoomRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ZoomGeometry = {
    scale: number;
    translateX: number;
    translateY: number;
    borderRadius: number;
    visibleBorderRadius: number;
};

/** Maps iOS overscroll to interactive transition progress. */
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

/**
 * Calculates the card transform and local corner radius for one frame.
 *
 * The transform still scales around the card's center. Its translation is
 * adjusted so the rendered top-left corner lands on the recorded artwork,
 * rather than centering the tall card around a square target.
 */
export function zoomGeometry(
    viewportWidth: number,
    viewportHeight: number,
    origin: ZoomRect | null,
    progress: number,
): ZoomGeometry {
    "worklet";
    const p = Math.min(Math.max(progress, 0), 1);
    const targetScale = origin
        ? Math.min(Math.max(origin.width / viewportWidth, MIN_SCALE), 1)
        : FALLBACK_SCALE;
    const targetWidth = viewportWidth * targetScale;

    const targetTranslateX = origin
        ? origin.x - (viewportWidth - targetWidth) / 2
        : 0;
    const targetTranslateY = origin
        ? origin.y - (viewportHeight - viewportHeight * targetScale) / 2
        : viewportHeight * 0.8 - viewportHeight / 2;

    const scale = 1 - p * (1 - targetScale);
    const targetVisibleRadius = Math.min(
        MAX_TARGET_VISIBLE_RADIUS,
        targetWidth * TARGET_RADIUS_RATIO,
    );
    const visibleBorderRadius =
        FULL_VISIBLE_RADIUS + (targetVisibleRadius - FULL_VISIBLE_RADIUS) * p;

    return {
        scale,
        translateX: targetTranslateX * p,
        translateY: targetTranslateY * p,
        // A radius inside a scaled view scales too. Compensate so the corner
        // seen on screen follows the intended continuous curve.
        borderRadius: visibleBorderRadius / scale,
        visibleBorderRadius,
    };
}
