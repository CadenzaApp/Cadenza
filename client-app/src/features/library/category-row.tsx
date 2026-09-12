import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";

import { LIBRARY_CATEGORY_META, type LibraryCategory } from "./categories";

/** One row of the library index. Opens the category as a sheet. */
export function CategoryRow({
    category,
    onPress,
}: {
    category: LibraryCategory;
    onPress: (category: LibraryCategory) => void;
}) {
    const { colors } = useTheme();
    const { label, icon } = LIBRARY_CATEGORY_META[category];

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${label}`}
            onPress={() => onPress(category)}
            className="flex-row items-center gap-4 py-3.5 active:opacity-60"
        >
            <Ionicons name={icon} size={22} color={colors.notification} />
            <View className="-mb-3.5 flex-1 flex-row items-center justify-between border-b border-border pb-3.5">
                <Text className="text-lg">{label}</Text>
                <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={colors.text}
                />
            </View>
        </Pressable>
    );
}
