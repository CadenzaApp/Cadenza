import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { withAlpha } from "@/lib/artwork-color";
import { useAppTheme } from "@/lib/theme";

/** A thin line across a list with a short label in the middle. */
export function ListDivider({ label }: { label: string }) {
    const { mutedForeground } = useAppTheme().colors;
    const lineColor = withAlpha(mutedForeground, 0.55);
    return (
        <View className="flex-row items-center gap-3 py-3">
            <View
                className="h-px flex-1"
                style={{ backgroundColor: lineColor }}
            />
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
            </Text>
            <View
                className="h-px flex-1"
                style={{ backgroundColor: lineColor }}
            />
        </View>
    );
}
