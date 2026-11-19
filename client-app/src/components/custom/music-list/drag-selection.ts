/** Find the measured row under a content-space coordinate, including grouped headers. */
export function rowAtPosition(
    count: number,
    y: number,
    layout: (index: number) => { y: number; height: number } | undefined,
): number {
    let low = 0;
    let high = count - 1;
    while (low <= high) {
        const index = (low + high) >>> 1;
        const row = layout(index);
        if (!row) return -1;
        if (y < row.y) high = index - 1;
        else if (y >= row.y + row.height) low = index + 1;
        else return index;
    }
    return -1;
}

/** Signed points per second; hold near an edge to keep scrolling. */
export function selectionScrollSpeed(y: number, height: number): number {
    const edge = Math.min(72, height / 3);
    if (edge <= 0) return 0;
    if (y < edge) return -1500 * Math.min(1, (edge - y) / edge);
    if (y > height - edge)
        return 1500 * Math.min(1, (y - height + edge) / edge);
    return 0;
}
