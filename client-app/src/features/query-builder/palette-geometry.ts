export const TAG_PALETTE_MIN_HEIGHT = 64;
export const TAG_PALETTE_MAX_HEIGHT = 450;

/** The sheet stays laid out at full height; only this translation changes. */
export function paletteTranslation(
    visibleHeight: number,
    sheetHeight?: number,
) {
    "worklet";
    // Captured constants are only available inside the serialized worklet body.
    const maximum = sheetHeight ?? TAG_PALETTE_MAX_HEIGHT;
    return Math.max(0, maximum - visibleHeight);
}
export function clampPaletteHeight(
    height: number,
    minimum: number,
    maximum?: number,
) {
    "worklet";
    const limit = maximum ?? TAG_PALETTE_MAX_HEIGHT;
    return Math.min(limit, Math.max(Math.min(minimum, limit), height));
}
