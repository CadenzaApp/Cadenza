import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { useCloseScreen } from "@/lib/zoom-dismiss";

/** Gap between the safe area and the button. */
const TOP_GAP = 8;

/**
 * The X a screen that draws its own hero floats in the top right, where
 * `DetailScreen` puts its own. It closes through `useCloseScreen`, so it plays
 * the same minimize the pull does.
 *
 * It has to be a component rather than a call in the screen: the controller
 * lives in the `ZoomDismissScreen` the screen renders, so only something
 * underneath it can read one.
 */
export function FloatingCloseButton({
    label,
    size,
}: {
    label: string;
    size?: number;
}) {
    const insets = useSafeAreaInsets();
    const close = useCloseScreen();

    return (
        <View
            className="absolute right-5"
            style={{ top: insets.top + TOP_GAP }}
            pointerEvents="box-none"
        >
            <GlassIconButton
                size={size}
                accessibilityLabel={label}
                onPress={close}
            >
                <Ionicons name="close" size={22} color="#ffffff" />
            </GlassIconButton>
        </View>
    );
}
