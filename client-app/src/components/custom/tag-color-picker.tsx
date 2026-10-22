import { SwatchGrid } from "@/components/custom/color-picker";
import { useSwatchSet } from "@/lib/use-swatch-set";

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
    const swatches = useSwatchSet("tagColor");
    const { columns } = swatches.set;
    const swatchSize = Math.min(
        MAX_SWATCH_SIZE,
        Math.floor((width - GRID_GAP * (columns - 1)) / columns),
    );

    return (
        <SwatchGrid
            pickerTitle="Tag color"
            columns={columns}
            swatchSize={swatchSize}
            slots={swatches.slots}
            selected={selectedColor}
            onSelect={(color) => {
                if (color) onSelectColor(color);
            }}
            onEdit={(slots, selected) => {
                swatches.edit(slots, selected);
                // removing the tag's color from the grid leaves the tag as is
                if (selected) onSelectColor(selected);
            }}
            newColorStart={selectedColor}
            editable={swatches.editable}
        />
    );
}
