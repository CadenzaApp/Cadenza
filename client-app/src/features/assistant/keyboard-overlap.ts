/** The space a bottom-aligned sheet still needs after any native resize. */
export function keyboardOverlap(
    keyboardHeight: number,
    restingHeight: number,
    bodyHeight: number,
): number {
    const resizedBy = Math.max(0, restingHeight - bodyHeight);
    return Math.max(0, keyboardHeight - resizedBy);
}
