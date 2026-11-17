import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";

/** A shelf's title, and See all on the right when it opens somewhere. */
export function ShelfHeader({
    title,
    onSeeAll,
}: {
    title: string;
    onSeeAll?: () => void;
}) {
    const { brand } = useAppTheme().colors;
    return (
        <View className="flex-row items-center justify-between gap-3">
            <Text
                role="heading"
                className="text-xl font-semibold text-foreground"
            >
                {title}
            </Text>
            {onSeeAll ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`See all ${title.toLowerCase()}`}
                    onPress={onSeeAll}
                    hitSlop={8}
                    className="flex-row items-center gap-0.5 active:opacity-60"
                >
                    <Text className="text-sm font-medium text-brand">
                        See all
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={brand} />
                </Pressable>
            ) : null}
        </View>
    );
}
