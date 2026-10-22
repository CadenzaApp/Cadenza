import { useUserSettings, type UserSettingsPatch } from "./routes/settings";
import type { SwatchSlots } from "./swatch-slots";
import {
    SWATCH_SETS,
    swatchSetEdit,
    swatchSetSlots,
    type SwatchSet,
    type SwatchSetKind,
} from "./swatch-sets";

/**
 * One saved color grid from `SWATCH_SETS`, wired to `/settings`: its slots,
 * its pick, and the saves for picking and editing. `editable` is false until
 * the saved slots load, so an edit cannot save the presets over them.
 */
export function useSwatchSet(kind: SwatchSetKind) {
    const set: SwatchSet = SWATCH_SETS[kind];
    const { settings, settingsLoaded, updateSettings } = useUserSettings();

    function save(change: UserSettingsPatch) {
        void updateSettings(change).catch((error) =>
            console.error(`Failed to save ${kind} colors:`, error),
        );
    }

    return {
        set,
        slots: swatchSetSlots(set, settings),
        editable: settingsLoaded,
        /** The saved pick, or null for the fixed circle or a grid with none. */
        selected: set.selection ? settings[set.selection.key] : null,
        select(color: string | null) {
            if (set.selection) save({ [set.selection.key]: color });
        },
        edit(slots: SwatchSlots, selected: string | null) {
            save(swatchSetEdit(set, slots, selected));
        },
    };
}
