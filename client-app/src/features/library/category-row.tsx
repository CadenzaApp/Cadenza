import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useZoomSource } from "@/lib/zoom-dismiss";

import { LIBRARY_CATEGORY_META, type LibraryCategory } from "./categories";

/** One row of the library index. Opens the category screen. */
export function CategoryRow({
    category,
    onPress,
}: {
    category: LibraryCategory;
    onPress: (category: LibraryCategory) => void;
}) {
    const { colors } = useTheme();
    const { ref: zoomRef, capture: captureZoom } = useZoomSource();
    const { label, icon } = LIBRARY_CATEGORY_META[category];

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${label}`}
            onPress={() => {
                // The row is what the category screen grows out of and
                // shrinks back into.
                captureZoom();
                onPress(category);
            }}
            ref={zoomRef}
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
