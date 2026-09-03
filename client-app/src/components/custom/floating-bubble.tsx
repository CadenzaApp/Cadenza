import { useSegments } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { usePlayback } from "@/lib/playback";

const DEFAULT_BOTTOM_OFFSET = 24;
const COMPACT_PLAYER_HEIGHT = 64;
const COMPACT_PLAYER_GAP = 16;

type FloatingBubbleProps = {
    children: ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityState?: { expanded?: boolean };
    bottomOffset?: number;
};

/**
 * A circular action button pinned to the lower-right corner of its parent.
 * It automatically clears the persistent compact media player when present.
 */
export function FloatingBubble({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
    bottomOffset = DEFAULT_BOTTOM_OFFSET,
}: FloatingBubbleProps) {
    const { activeTrack } = usePlayback();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const segments = useSegments();
    const rootSegment = segments[0];
    const isCompactPlayerVisible =
        activeTrack != null &&
        (rootSegment === "(tabs)" || rootSegment === "tag");
    const adjustedBottomOffset = isCompactPlayerVisible
        ? Math.max(
              bottomOffset,
              // Tab-screen content already stops above the tab bar. Only
              // full-screen tag routes need to account for the safe area.
              (rootSegment === "(tabs)" ? 0 : insets.bottom) +
                  COMPACT_PLAYER_HEIGHT +
                  COMPACT_PLAYER_GAP,
          )
        : bottomOffset;

    return (
        <View
            style={{
                position: "absolute",
                right: 24,
                bottom: adjustedBottomOffset,
                zIndex: 10,
                elevation: 10,
            }}
        >
            <Button
                size="icon"
                className="h-14 w-14 rounded-full"
                style={{
                    backgroundColor: colors.text,
                    shadowColor: "#000",
                    shadowOpacity: 0.16,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 4 },
                }}
                onPress={onPress}
                accessibilityLabel={accessibilityLabel}
                accessibilityState={accessibilityState}
            >
                {children}
            </Button>
        </View>
    );
}
