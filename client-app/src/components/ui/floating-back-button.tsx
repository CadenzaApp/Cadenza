import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Ionicons from "@expo/vector-icons/Ionicons";

import { GlassIconButton } from "@/components/ui/glass-icon-button";

/** Gap between the safe area and the button. */
const TOP_GAP = 8;

/**
 * The back button a pushed screen that draws its own hero floats in the top
 * left, where a native header puts its own.
 */
export function FloatingBackButton({
    label = "Back",
    size,
}: {
    label?: string;
    size?: number;
}) {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { colors } = useTheme();

    return (
        <View
            className="absolute left-5"
            style={{ top: insets.top + TOP_GAP }}
            pointerEvents="box-none"
        >
            <GlassIconButton
                size={size}
                bordered={false}
                accessibilityLabel={label}
                onPress={() => router.back()}
            >
                <Ionicons name="chevron-back" size={24} color={colors.text} />
            </GlassIconButton>
        </View>
    );
}
