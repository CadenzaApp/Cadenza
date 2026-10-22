import { SwatchGrid } from "@/components/custom/color-picker";
import { useUserSettings } from "@/lib/routes/settings";
import { resolveSwatchSlots } from "@/lib/swatch-slots";
import { TAG_COLOR_OPTIONS } from "@/lib/tag-color-palette";

export { TAG_COLOR_OPTIONS } from "@/lib/tag-color-palette";

/** Four rows of five: the curated colors, four custom slots, and the +. */
const COLOR_COLUMNS = 5;
const TAG_COLOR_SLOTS = 19;
const GRID_GAP = 8;
const MAX_SWATCH_SIZE = 52;

/**
 * The color grid used when creating or recoloring a tag. Starts as the
 * curated palette with room for custom colors; every color can be changed or
 * removed by holding it, and the slots save to the account as
 * `tag_color_swatches`. A tag keeps its color even if that color is later
 * removed from the grid.
 */
export function TagColorPicker({
    width,
    selectedColor,
    onSelectColor,
}: {
    width: number;
    selectedColor: string;
    onSelectColor: (color: string) => void;
}) {
    const { settings, settingsLoaded, updateSettings } = useUserSettings();
    const swatchSize = Math.min(
        MAX_SWATCH_SIZE,
        Math.floor((width - GRID_GAP * (COLOR_COLUMNS - 1)) / COLOR_COLUMNS),
    );

    return (
        <SwatchGrid
            pickerTitle="Tag color"
            columns={COLOR_COLUMNS}
            swatchSize={swatchSize}
            slots={resolveSwatchSlots(
                settings.tag_color_swatches,
                TAG_COLOR_OPTIONS,
                TAG_COLOR_SLOTS,
            )}
            selected={selectedColor}
            onSelect={(color) => {
                if (color) onSelectColor(color);
            }}
            onEdit={(slots, selected) => {
                void updateSettings({ tag_color_swatches: slots }).catch(
                    (error) =>
                        console.error("Failed to save tag colors:", error),
                );
                // removing the tag's color from the grid leaves the tag as is
                if (selected) onSelectColor(selected);
            }}
            newColorStart={selectedColor}
            editable={settingsLoaded}
        />
    );
}
