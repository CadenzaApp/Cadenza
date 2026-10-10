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
    /** The visible card, in screen points. */
    clip: ZoomRect;
    /** How much the page inside the card is scaled. */
    scale: number;
    /** Where the page's top-left corner sits inside the card. */
    contentX: number;
    contentY: number;
    /** The card's corner radius, on screen. */
    borderRadius: number;
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
 * Share of the close spent collapsing the page up to its artwork. The rest
 * moves and shrinks that artwork onto the tile it opened from.
 */
export const ZOOM_COLLAPSE_SHARE = 0.4;

/**
 * The card at one point of the close, 0 the full screen and 1 sitting on the
 * tile it opened from. The open is the same frames run backwards.
 *
 * Two phases, the way Apple Music closes an album. First the bottom of the
 * card collapses up to just under the artwork, the page itself untouched.
 * Then the card and the page move and shrink together, so the artwork lands
 * exactly on its tile and the tile can take over. The card is a clip over the
 * page, not the page scaled whole: a whole page shrunk to the tile's width
 * kept the screen's tall shape and hung below the tile.
 *
 * `focus` is the artwork on screen while the card is full size, null when
 * there is none or it is scrolled out of sight. The top of the page stands in
 * for it then. `origin` null means nothing was recorded, so the card closes
 * to a square in the middle of the screen.
 */
export function zoomFrame(
    viewportWidth: number,
    viewportHeight: number,
    origin: ZoomRect | null,
    focus: ZoomRect | null,
    progress: number,
): ZoomFrame {
    "worklet";
    const p = Math.min(Math.max(progress, 0), 1);
    const target = origin ?? centeredSquare(viewportWidth, viewportHeight);
    const art =
        focus &&
        focus.width > 0 &&
        focus.height > 0 &&
        focus.y + focus.height > 0 &&
        focus.y < viewportHeight
            ? focus
            : { x: 0, y: 0, width: viewportWidth, height: viewportWidth };
    const artBottom = Math.min(art.y + art.height, viewportHeight);

    const collapse = ease(Math.min(p / ZOOM_COLLAPSE_SHARE, 1));
    const shrink = ease(
        Math.max(0, (p - ZOOM_COLLAPSE_SHARE) / (1 - ZOOM_COLLAPSE_SHARE)),
    );

    // the part of the page showing, in page points: the whole width down to
    // the collapsing bottom, then closing in on the artwork itself
    const top = lerp(0, art.y, shrink);
    const left = lerp(0, art.x, shrink);
    const right = lerp(viewportWidth, art.x + art.width, shrink);
    const bottom = lerp(
        lerp(viewportHeight, artBottom, collapse),
        artBottom,
        shrink,
    );

    // page to screen: identity at the start of the shrink, and the artwork
    // exactly on the target at its end
    const endScale = target.width / art.width;
    const scale = lerp(1, endScale, shrink);
    const offsetX = lerp(0, target.x - art.x * endScale, shrink);
    const offsetY = lerp(0, target.y - art.y * endScale, shrink);

    const targetRadius = Math.min(
        MAX_TARGET_VISIBLE_RADIUS,
        target.width * TARGET_RADIUS_RATIO,
    );
    return {
        clip: {
            x: left * scale + offsetX,
            y: top * scale + offsetY,
            width: (right - left) * scale,
            height: (bottom - top) * scale,
        },
        scale,
        contentX: -left * scale,
        contentY: -top * scale,
        borderRadius: lerp(FULL_VISIBLE_RADIUS, targetRadius, shrink),
    };
}

function lerp(from: number, to: number, t: number) {
    "worklet";
    return from + (to - from) * t;
}

/** Slow in and out, so each phase starts and lands softly. */
function ease(t: number) {
    "worklet";
    return t * t * (3 - 2 * t);
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
