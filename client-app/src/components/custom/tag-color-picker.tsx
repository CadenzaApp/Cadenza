import { Pressable, View } from "react-native";

import { TAG_COLOR_OPTIONS } from "@/lib/tag-color-palette";

export { TAG_COLOR_OPTIONS } from "@/lib/tag-color-palette";

const COLOR_COLUMNS = 5;
const GRID_GAP = 8;

const COLOR_ROWS = Array.from(
    { length: Math.ceil(TAG_COLOR_OPTIONS.length / COLOR_COLUMNS) },
    (_, index) => index,
);

/** The shared fixed palette used when creating or recoloring a tag. */
export function TagColorPicker({
    width,
    selectedColor,
    onSelectColor,
}: {
    width: number;
    selectedColor: string;
    onSelectColor: (color: string) => void;
}) {
    const colorBoxSize =
        (width - GRID_GAP * (COLOR_COLUMNS - 1)) / COLOR_COLUMNS;

    return (
        <View style={{ gap: GRID_GAP }}>
            {COLOR_ROWS.map((rowIndex) => (
                <View
                    key={rowIndex}
                    className="flex-row"
                    style={{ gap: GRID_GAP }}
                >
                    {TAG_COLOR_OPTIONS.slice(
                        rowIndex * COLOR_COLUMNS,
                        rowIndex * COLOR_COLUMNS + COLOR_COLUMNS,
                    ).map((color) => {
                        const isSelected = color === selectedColor;
                        return (
                            <Pressable
                                key={color}
                                onPress={() => onSelectColor(color)}
                                accessibilityRole="radio"
                                accessibilityLabel={`Tag color ${color}`}
                                accessibilityState={{ checked: isSelected }}
                                className={`items-center justify-center rounded-md ${isSelected ? "border-2 border-foreground" : ""}`}
                                style={{
                                    width: colorBoxSize,
                                    height: colorBoxSize,
                                    backgroundColor: color,
                                }}
                            />
                        );
                    })}
                </View>
            ))}
        </View>
    );
}
