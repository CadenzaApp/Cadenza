import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useMemo } from "react";

import { ScreenFloatingBubble } from "@/components/custom/floating-bubble";
import {
    BOTTOM_ACTION_RIGHT_OFFSET,
    useBottomRowActionButton,
    type BottomRowAction,
} from "@/lib/screen-overlay";
import { PLAYER_CONTROL_SIZE } from "@/lib/screen-overlay-geometry";

/**
 * A screen's one bottom action, like Library Tags' create or Social's new
 * post. It joins the player's control row above Search when the shared host
 * can place it, and floats on its own otherwise. The caller owns what the
 * press opens.
 */
export function BottomRowActionBubble({
    icon,
    accessibilityLabel,
    expanded,
    onPress,
}: BottomRowAction) {
    const { colors } = useTheme();
    const action = useMemo<BottomRowAction>(
        () => ({ icon, accessibilityLabel, expanded, onPress }),
        [icon, accessibilityLabel, expanded, onPress],
    );
    const showLocal = useBottomRowActionButton(action);
    if (!showLocal) return null;
    return (
        <ScreenFloatingBubble
            size={PLAYER_CONTROL_SIZE}
            rightOffset={BOTTOM_ACTION_RIGHT_OFFSET}
            bordered={false}
            shadow={false}
            onPress={onPress}
            accessibilityLabel={accessibilityLabel}
        >
            <Ionicons name={icon} size={28} color={colors.text} />
        </ScreenFloatingBubble>
    );
}
