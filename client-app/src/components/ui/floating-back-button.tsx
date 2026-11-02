import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import {
    AnimatedContrastIcon,
    useFloatingSurfaceContrast,
} from "@/lib/surface-contrast-context";

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
    const { iconStyle, scheme } = useFloatingSurfaceContrast(
        insets.top + TOP_GAP + (size ?? 40) / 2,
    );

    return (
        <View
            className="absolute left-5"
            style={{ top: insets.top + TOP_GAP }}
            pointerEvents="box-none"
        >
            <GlassIconButton
                size={size}
                bordered={false}
                surfaceScheme={scheme}
                accessibilityLabel={label}
                onPress={() => router.back()}
            >
                <AnimatedContrastIcon
                    name="chevron-back"
                    size={24}
                    color={colors.text}
                    style={iconStyle}
                />
            </GlassIconButton>
        </View>
    );
}
