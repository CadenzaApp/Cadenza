/**
 * Every editable color grid the app saves to `/settings`, in one place: its
 * presets, its size, which settings keys it writes, and what is picked when
 * the picked color is removed. Kept free of runtime imports beyond the import
 * free color lists, so it can be unit tested without React Native.
 */

import type { UserSettings } from "./routes/settings";
import { TAG_COLOR_OPTIONS } from "./tag-color-palette.ts";
import {
    ACCENT_PRESETS,
    BACKGROUND_PRESETS,
    GLASS_TINT_PRESETS,
} from "./theme/tokens.ts";
import { resolveSwatchSlots, type SwatchSlots } from "./swatch-slots.ts";

/** Most slots a saved list may hold. Matches `MAX_SWATCHES` in the backend. */
export const MAX_SWATCHES = 24;

type SlotsKey =
    | "accent_swatches"
    | "glass_tint_swatches"
    | "background_swatches"
    | "tag_color_swatches";

type SelectionKey = "accent_color" | "glass_tint" | "background_color";

export type SwatchSet = {
    /** Where the slots save. Null there means `presets`. */
    slotsKey: SlotsKey;
    presets: readonly string[];
    rows: number;
    columns: number;
    /** A fixed first circle (Default, None) that picking selects as null. */
    hasFixed: boolean;
    /**
     * The setting the picked color saves to, and what is picked when it is
     * removed: the fixed circle, or the first color left. None for a grid
     * whose pick belongs to something else, like a tag.
     */
    selection?: { key: SelectionKey; onRemove: "fixed" | "first" };
};

export const SWATCH_SETS = {
    accent: {
        slotsKey: "accent_swatches",
        presets: ACCENT_PRESETS,
        rows: 2,
        columns: 6,
        hasFixed: true,
        selection: { key: "accent_color", onRemove: "fixed" },
    },
    glassTint: {
        slotsKey: "glass_tint_swatches",
        presets: GLASS_TINT_PRESETS,
        rows: 2,
        columns: 6,
        hasFixed: true,
        selection: { key: "glass_tint", onRemove: "fixed" },
    },
    // custom mode always draws something, so removing the pick moves on
    background: {
        slotsKey: "background_swatches",
        presets: BACKGROUND_PRESETS,
        rows: 2,
        columns: 6,
        hasFixed: false,
        selection: { key: "background_color", onRemove: "first" },
    },
    tagColor: {
        slotsKey: "tag_color_swatches",
        presets: TAG_COLOR_OPTIONS,
        rows: 4,
        columns: 5,
        hasFixed: false,
    },
} as const satisfies Record<string, SwatchSet>;

export type SwatchSetKind = keyof typeof SWATCH_SETS;

/** Editable slots: every cell but the fixed circle and the +. */
export function slotCount(set: SwatchSet): number {
    return set.rows * set.columns - (set.hasFixed ? 1 : 0) - 1;
}

/** The slots `set` shows for `settings`. */
export function swatchSetSlots(
    set: SwatchSet,
    settings: Partial<Pick<UserSettings, SlotsKey>>,
): SwatchSlots {
    return resolveSwatchSlots(
        settings[set.slotsKey] ?? null,
        set.presets,
        slotCount(set),
    );
}

/**
 * The settings change for an edit to `set`'s slots. `selected` is what the
 * grid says to pick after it; a removed pick follows `selection.onRemove`.
 */
export function swatchSetEdit(
    set: SwatchSet,
    slots: SwatchSlots,
    selected: string | null,
): Partial<UserSettings> {
    if (!set.selection) return { [set.slotsKey]: slots };
    const picked =
        selected ??
        (set.selection.onRemove === "first"
            ? (slots.find((slot) => slot !== null) ?? null)
            : null);
    return { [set.slotsKey]: slots, [set.selection.key]: picked };
}

/**
 * What the custom mode draws: the picked background, else the first one in
 * the grid, else the first preset. The theme and the Appearance sheet both
 * read this, so they never disagree.
 */
export function customBackground(
    settings: Pick<UserSettings, "background_color" | "background_swatches">,
): string {
    return (
        settings.background_color ??
        swatchSetSlots(SWATCH_SETS.background, settings).find(
            (slot) => slot !== null,
        ) ??
        BACKGROUND_PRESETS[0]
    );
}
