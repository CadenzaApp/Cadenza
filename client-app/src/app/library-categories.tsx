import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailScreen } from "@/components/ui/detail-screen";
import { Text } from "@/components/ui/text";
import {
    LIBRARY_CATEGORY_META,
    LIBRARY_CATEGORY_ORDER,
} from "@/features/library/categories";
import { useLibraryCategories } from "@/features/library/library-categories";
import { useScreenScroll } from "@/lib/screen-scroll";

/** Picks which sections appear on the library screen. Any number of them. */
export default function LibraryCategoriesScreen() {
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const { isEnabled, toggle } = useLibraryCategories();
    const scroll = useScreenScroll();

    return (
        <DetailScreen title="Library">
            <Animated.ScrollView
                {...scroll}
                className="flex-1"
                contentContainerClassName="px-5 pt-2"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                <Text className="mb-4 text-muted-foreground">
                    Choose what shows on your library screen.
                </Text>

                {LIBRARY_CATEGORY_ORDER.map((category) => {
                    const { label, icon } = LIBRARY_CATEGORY_META[category];
                    const enabled = isEnabled(category);

                    return (
                        <Pressable
                            key={category}
                            accessibilityRole="checkbox"
                            accessibilityLabel={label}
                            accessibilityState={{ checked: enabled }}
                            onPress={() => toggle(category)}
                            className="flex-row items-center gap-4 border-b border-border py-4 active:opacity-60"
                        >
                            <Ionicons
                                name={
                                    enabled
                                        ? "checkmark-circle"
                                        : "ellipse-outline"
                                }
                                size={26}
                                color={
                                    enabled
                                        ? colors.notification
                                        : colors.border
                                }
                            />
                            <Ionicons
                                name={icon}
                                size={22}
                                color={colors.notification}
                            />
                            <View className="flex-1">
                                <Text className="text-lg">{label}</Text>
                            </View>
                        </Pressable>
                    );
                })}
            </Animated.ScrollView>
        </DetailScreen>
    );
}
