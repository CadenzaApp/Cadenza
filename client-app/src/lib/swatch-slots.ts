/**
 * Editable color slots, for the Appearance sheet and tag colors: a fixed count
 * of slots, each a color or empty. Saved per user, where null means "the
 * presets". Kept free of imports so it can be unit tested without React Native.
 */

export type SwatchSlots = (string | null)[];

/** The slots to show: the saved ones, or the presets, padded to `count`. */
export function resolveSwatchSlots(
    stored: SwatchSlots | null,
    presets: readonly string[],
    count: number,
): SwatchSlots {
    const source = stored ?? presets;
    return Array.from(
        { length: count },
        (_, index) => source[index] ?? null,
    );
}

/** `slots` with slot `index` set to `color`, or emptied by null. */
export function setSwatchSlot(
    slots: SwatchSlots,
    index: number,
    color: string | null,
): SwatchSlots {
    return slots.map((slot, at) => (at === index ? color : slot));
}

/** The first empty slot, or -1 when every slot holds a color. */
export function firstEmptySlot(slots: SwatchSlots): number {
    return slots.indexOf(null);
}

/**
 * What the selection should be after slot `index` changes to `next`. A color
 * no slot holds any more drops to null, the default, unless the fixed slot is
 * what was selected.
 */
export function selectionAfterEdit(
    selected: string | null,
    slots: SwatchSlots,
    index: number,
    next: string | null,
): string | null {
    if (selected === null || slots[index] !== selected) return selected;
    const stillHeld = slots.some(
        (slot, at) => at !== index && slot === selected,
    );
    if (stillHeld) return selected;
    // the selected color was edited: follow it to its new value, or drop it
    return next;
}
