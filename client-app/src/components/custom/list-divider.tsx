import { View } from "react-native";

import { Text } from "@/components/ui/text";

/** A thin line across a list with a short label in the middle. */
export function ListDivider({ label }: { label: string }) {
    return (
        <View className="flex-row items-center gap-3 py-3">
            <View className="h-px flex-1 bg-border" />
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
            </Text>
            <View className="h-px flex-1 bg-border" />
        </View>
    );
}
