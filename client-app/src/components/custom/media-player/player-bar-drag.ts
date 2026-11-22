/** Nearest tab after a short velocity projection, clamped to the bar's ends. */
export function releasedPageIndex(
    offset: number,
    velocityX: number,
    itemWidth: number,
    pageWidth: number,
    pageCount: number,
): number {
    "worklet";
    if (itemWidth <= 0 || pageWidth <= 0) return 0;
    return Math.max(
        0,
        Math.min(
            pageCount - 1,
            Math.round(offset / pageWidth + (velocityX * 0.12) / itemWidth),
        ),
    );
}

/** Center the selection under a bar-local thumb coordinate. */
export function pageOffsetAtBarX(
    x: number,
    itemWidth: number,
    pageWidth: number,
    pageCount: number,
    inset = 0,
): number {
    "worklet";
    if (itemWidth <= 0 || pageWidth <= 0) return 0;
    return (
        Math.max(0, Math.min(pageCount - 1, (x - inset) / itemWidth - 0.5)) *
        pageWidth
    );
}

/** One capsule contour and its complementary outer contour for alpha masks. */
export function playerPillMask(
    progress: number,
    width: number,
    height: number,
    count: number,
) {
    "worklet";
    const item = width / count;
    const position = Math.max(0, Math.min(count - 1, progress));
    const stretch =
        item * 0.12 * Math.sin(Math.PI * (position - Math.floor(position)));
    const pillWidth = item + stretch;
    const left = position * item - stretch / 2;
    const r = Math.min(height / 2, pillWidth / 2);
    const right = left + pillWidth;
    const inside = `M${left + r},0H${right - r}A${r},${r} 0 0 1 ${right},${r}V${height - r}A${r},${r} 0 0 1 ${right - r},${height}H${left + r}A${r},${r} 0 0 1 ${left},${height - r}V${r}A${r},${r} 0 0 1 ${left + r},0Z`;
    return {
        left,
        width: pillWidth,
        inside,
        outside: `M0,0H${width}V${height}H0Z${inside}`,
    };
}
