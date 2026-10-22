import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { useAppTheme } from "@/lib/theme";
import {
    firstEmptySlot,
    selectionAfterEdit,
    setSwatchSlot,
    type SwatchSlots,
} from "@/lib/swatch-slots";

import { ColorPickerModal } from "./color-picker-modal";

/** The ring around a swatch is this much wider than the swatch. */
const RING_INSET = 8;

type Editing = { index: number; mode: "add" | "edit" };

type SwatchGridProps = {
    /** Title of the color picker when it opens. */
    pickerTitle: string;
    /** Circles per row. */
    columns: number;
    /** Diameter of a circle with its selection ring, in points. */
    swatchSize?: number;
    /**
     * An optional first circle, which can be picked but never changed or
     * removed. A null color draws it as "none". Picking it selects null.
     */
    fixed?: { label: string; color: string | null };
    /** Every editable slot, a color or null for empty. */
    slots: SwatchSlots;
    /** The picked color, or null for the fixed one or none. */
    selected: string | null;
    onSelect: (color: string | null) => void;
    /** A slot was added, changed, or removed, and what to select after. */
    onEdit: (slots: SwatchSlots, selected: string | null) => void;
    /** What the picker opens on for a new color. */
    newColorStart: string;
};

/**
 * Rows of color circles: the fixed one if there is one, every slot, and a +
 * in the last cell that adds to the first empty slot. Tap a color to pick it,
 * tap an empty slot to fill it, and hold a color to change or remove it. The
 * picker is `ColorPickerModal`.
 *
 * Make `columns` divide the cell count (fixed, slots, and the +) so the last
 * row is full.
 */
export function SwatchGrid({
    pickerTitle,
    columns,
    swatchSize = 44,
    fixed,
    slots,
    selected,
    onSelect,
    onEdit,
    newColorStart,
}: SwatchGridProps) {
    const [editing, setEditing] = useState<Editing | null>(null);
    const emptySlot = firstEmptySlot(slots);
    // one ring, on the first slot holding the selection
    const selectedIndex = selected === null ? -1 : slots.indexOf(selected);

    function finish(
        index: number,
        color: string | null,
        mode: Editing["mode"],
    ) {
        const next = setSwatchSlot(slots, index, color);
        // a new color is picked as it is added
        const nextSelected =
            mode === "add" && color
                ? color
                : selectionAfterEdit(selected, slots, index, color);
        onEdit(next, nextSelected);
        setEditing(null);
    }

    function slotCell(index: number) {
        const color = slots[index];
        if (!color) {
            return (
                <EmptySlot
                    key={`slot-${index}`}
                    size={swatchSize}
                    onPress={() => setEditing({ index, mode: "add" })}
                />
            );
        }
        return (
            <Swatch
                key={`slot-${index}`}
                size={swatchSize}
                label={`Color ${color}`}
                color={color}
                selected={index === selectedIndex}
                onPress={() => onSelect(color)}
                onLongPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setEditing({ index, mode: "edit" });
                }}
            />
        );
    }

    const cells: ReactNode[] = [
        fixed ? (
            <Swatch
                key="fixed"
                size={swatchSize}
                label={fixed.label}
                color={fixed.color}
                selected={selected === null}
                onPress={() => onSelect(null)}
            />
        ) : null,
        ...slots.map((_, index) => slotCell(index)),
        <AddButton
            key="add"
            size={swatchSize}
            disabled={emptySlot === -1}
            onPress={() => setEditing({ index: emptySlot, mode: "add" })}
        />,
    ].filter((cell) => cell !== null);
    const rows = Array.from(
        { length: Math.ceil(cells.length / columns) },
        (_, row) => cells.slice(row * columns, row * columns + columns),
    );

    const editingColor = editing ? slots[editing.index] : null;

    return (
        <View className="gap-3">
            {rows.map((row, index) => (
                <View key={index} className="flex-row justify-between">
                    {row}
                </View>
            ))}

            {editing ? (
                <ColorPickerModal
                    key={`${editing.mode}-${editing.index}`}
                    title={pickerTitle}
                    initialColor={editingColor ?? newColorStart}
                    onDone={(color) =>
                        finish(editing.index, color, editing.mode)
                    }
                    onClose={() => setEditing(null)}
                    onRemove={
                        editing.mode === "edit"
                            ? () => finish(editing.index, null, "edit")
                            : undefined
                    }
                />
            ) : null}
        </View>
    );
}

/**
 * A color circle with a ring when picked. Colors are inline styles: toggled
 * classes lagged a step behind when the theme changed under them.
 */
function Swatch({
    size,
    label,
    color,
    selected,
    onPress,
    onLongPress,
}: {
    size: number;
    label: string;
    /** Null draws a slashed "none" circle. */
    color: string | null;
    selected: boolean;
    onPress: () => void;
    onLongPress?: () => void;
}) {
    const { colors } = useAppTheme();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={
                onLongPress ? "Hold to change or remove" : undefined
            }
            accessibilityState={{ selected }}
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={350}
            hitSlop={4}
            className="active:opacity-60"
        >
            <View
                className="items-center justify-center rounded-full border-2"
                style={{
                    width: size,
                    height: size,
                    borderColor: selected ? colors.foreground : "transparent",
                }}
            >
                {/* "none" gets a solid fill so a glass tint under the panel
                    does not show through it */}
                <View
                    className="items-center justify-center rounded-full border border-border"
                    style={{
                        width: size - RING_INSET,
                        height: size - RING_INSET,
                        backgroundColor: color ?? colors.secondary,
                    }}
                >
                    {color === null ? (
                        <Ionicons
                            name="remove-outline"
                            size={22}
                            color={colors.mutedForeground}
                            style={{ transform: [{ rotate: "-45deg" }] }}
                        />
                    ) : null}
                </View>
            </View>
        </Pressable>
    );
}

/** A dashed circle that fills with a new color when tapped. */
function EmptySlot({ size, onPress }: { size: number; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a color here"
            onPress={onPress}
            hitSlop={4}
            className="active:opacity-60"
        >
            <View
                className="items-center justify-center"
                style={{ width: size, height: size }}
            >
                <View
                    className="rounded-full border border-dashed border-muted-foreground/40"
                    style={{
                        width: size - RING_INSET,
                        height: size - RING_INSET,
                    }}
                />
            </View>
        </Pressable>
    );
}

function AddButton({
    size,
    disabled,
    onPress,
}: {
    size: number;
    disabled: boolean;
    onPress: () => void;
}) {
    const { colors } = useAppTheme();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a color"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            hitSlop={4}
            className="active:opacity-60"
        >
            <View
                className="items-center justify-center"
                style={{ width: size, height: size }}
            >
                <View
                    className="items-center justify-center rounded-full border border-border"
                    style={{
                        width: size - RING_INSET,
                        height: size - RING_INSET,
                        backgroundColor: colors.secondary,
                        opacity: disabled ? 0.4 : 1,
                    }}
                >
                    <Ionicons name="add" size={22} color={colors.foreground} />
                </View>
            </View>
        </Pressable>
    );
}
