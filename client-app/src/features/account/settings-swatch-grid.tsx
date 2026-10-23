import { SwatchGrid } from "@/components/custom/color-picker";
import { useSwatchSet } from "@/lib/use-swatch-set";
import type { SwatchSetKind } from "@/lib/swatch-sets";

/**
 * A `SwatchGrid` for one of the saved grids in `SWATCH_SETS`. Size, slots,
 * and saves come from the set; the caller adds what only the screen knows.
 */
export function SettingsSwatchGrid({
    kind,
    pickerTitle,
    fixed,
    newColorStart,
    selected,
}: {
    kind: SwatchSetKind;
    pickerTitle: string;
    /** The fixed first circle, for a set with `hasFixed`. */
    fixed?: { label: string; color: string | null };
    newColorStart: string;
    /** Overrides the saved pick, for a pick with a fallback. */
    selected?: string | null;
}) {
    const swatches = useSwatchSet(kind);

    return (
        <SwatchGrid
            pickerTitle={pickerTitle}
            columns={swatches.set.columns}
            fixed={fixed}
            slots={swatches.slots}
            selected={selected !== undefined ? selected : swatches.selected}
            onSelect={swatches.select}
            onEdit={swatches.edit}
            newColorStart={newColorStart}
            editable={swatches.editable}
        />
    );
}
