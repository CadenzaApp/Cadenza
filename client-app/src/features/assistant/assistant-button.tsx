import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { FloatingBubble } from "@/components/custom/floating-bubble";
import { useBottomSelectionOverlay } from "@/lib/bottom-selection-overlay";
import {
    useBottomBarsHidden,
    useBottomRowAction,
    useMeasuredFloatingActionBottom,
} from "@/lib/screen-overlay";
import {
    OVERLAY_GAP,
    PLAYER_CONTROL_SIZE,
    PLAYER_SIDE_INSET,
} from "@/lib/screen-overlay-geometry";
import { useAppTheme } from "@/lib/theme";

/**
 * The round button that opens the assistant, lower right, over a tab's own
 * screen. Rendered once per tab by `TabStack`, beside its stack, and shown only
 * while that tab's root screen is the one on top, so detail screens keep their
 * corner.
 *
 * It sits where a screen's floating action would (`floatingActionBottom`).
 * When the screen has one of its own in the bottom row (sort, create tag), it
 * moves one slot up so the two never cover each other. Hidden while the bottom
 * bars are (focused Search) and while a song selection toolbar is up.
 */
export function AssistantButton({ tab }: { tab: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const { colors } = useAppTheme();
    const barsHidden = useBottomBarsHidden();
    const rowAction = useBottomRowAction();
    const selection = useBottomSelectionOverlay();
    const { bottom, measuring, measureRef, onMeasureLayout } =
        useMeasuredFloatingActionBottom();

    if (pathname !== `/${tab}` || barsHidden || selection != null) return null;

    const lift = rowAction ? PLAYER_CONTROL_SIZE + OVERLAY_GAP : 0;

    return (
        <>
            {measuring ? (
                <View
                    ref={measureRef}
                    onLayout={onMeasureLayout}
                    collapsable={false}
                    pointerEvents="none"
                    style={StyleSheet.absoluteFill}
                />
            ) : null}
            <FloatingBubble
                size={PLAYER_CONTROL_SIZE}
                rightOffset={PLAYER_SIDE_INSET}
                bottomOffset={bottom + lift}
                onPress={() => router.push("/assistant")}
                accessibilityLabel="Open the assistant"
            >
                <Ionicons name="sparkles" size={24} color={colors.brand} />
            </FloatingBubble>
        </>
    );
}
