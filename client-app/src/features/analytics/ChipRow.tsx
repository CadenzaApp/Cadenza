import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type Props<T extends string> = {
    options: readonly T[];
    selected: T;
    onSelect: (value: T) => void;
    labelOf: (value: T) => string;
};

/** One row of selectable chips, which is how every picker on this tab works. */
export function ChipRow<T extends string>({
    options,
    selected,
    onSelect,
    labelOf,
}: Props<T>) {
    return (
        <View className="flex-row flex-wrap gap-2">
            {options.map((option) => {
                const isSelected = option === selected;
                return (
                    <Pressable
                        key={option}
                        onPress={() => onSelect(option)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        className={cn(
                            "border-border rounded-full border px-3 py-1",
                            isSelected && "bg-primary border-primary",
                        )}
                    >
                        <Text
                            className={cn(
                                "text-xs capitalize",
                                isSelected
                                    ? "text-primary-foreground"
                                    : "text-muted-foreground",
                            )}
                        >
                            {labelOf(option)}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}
