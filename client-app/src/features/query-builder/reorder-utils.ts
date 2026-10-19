export function edgeScrollDelta(
    finger: number,
    viewport: number,
    elapsedMs: number,
): number {
    "worklet";
    if (viewport <= 0 || elapsedMs <= 0) return 0;
    const edge = Math.min(72, viewport / 3);
    const direction =
        finger < edge
            ? -(1 - Math.max(0, finger) / edge)
            : finger > viewport - edge
              ? 1 - Math.max(0, viewport - finger) / edge
              : 0;
    return (direction * 600 * Math.min(elapsedMs, 32)) / 1000;
}

export function reorderLayout(
    order: readonly string[],
    heights: Readonly<Record<string, number>>,
) {
    "worklet";
    const tops: Record<string, number> = {};
    const centers: Record<string, number> = {};
    let total = 0;
    for (const key of order) {
        tops[key] = total;
        centers[key] = total + (heights[key] ?? 0) / 2;
        total += heights[key] ?? 0;
    }
    return { tops, centers, total };
}
export function reorderIndexAtCenter(
    order: readonly string[],
    centers: Readonly<Record<string, number>>,
    key: string,
    center: number,
) {
    "worklet";
    let index = 0;
    for (const item of order)
        if (item !== key && center > centers[item]) index++;
    return index;
}
export function moveReorderKey(
    order: readonly string[],
    key: string,
    index: number,
) {
    "worklet";
    const next = order.filter((item) => item !== key);
    next.splice(index, 0, key);
    return next;
}
/** React acknowledgement alone is not proof that native rows have moved yet. */
export function reorderLayoutMatches(
    order: readonly string[],
    acknowledged: readonly string[],
    tops: Readonly<Record<string, number>>,
    nativeTops: Readonly<Record<string, number>>,
) {
    "worklet";
    return (
        order.length === acknowledged.length &&
        order.every(
            (key, index) =>
                acknowledged[index] === key &&
                nativeTops[key] !== undefined &&
                Math.abs(nativeTops[key] - tops[key]) < 0.5,
        )
    );
}

/** Every release ends in a committed order or an explicit rollback. */
export async function completeReorderDrop({
    drop,
    rollback,
    complete,
    onError,
}: {
    drop: () => Promise<boolean>;
    rollback: () => void;
    complete: () => void;
    onError: (error: unknown) => void;
}) {
    try {
        let applied = false;
        try {
            applied = await drop();
        } catch (error) {
            onError(error);
        }
        if (!applied) rollback();
    } finally {
        complete();
    }
}
