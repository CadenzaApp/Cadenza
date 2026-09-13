import { useTheme } from "expo-router/react-navigation";
import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";

const DEFAULT_BOTTOM_OFFSET = 24;

type FloatingBubbleProps = {
    children: ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityState?: ComponentProps<typeof Button>["accessibilityState"];
    bottomOffset?: number;
    rightOffset?: number;
};

/** Pure circular action button pinned to the lower-right of its parent. */
export function FloatingBubble({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
    bottomOffset = DEFAULT_BOTTOM_OFFSET,
    rightOffset = 24,
}: FloatingBubbleProps) {
    const { colors } = useTheme();

    return (
        <View
            style={{
                position: "absolute",
                right: rightOffset,
                bottom: bottomOffset,
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

/** Screen-aware bubble that clears the compact player when it is visible. */
export function ScreenFloatingBubble(
    props: Omit<FloatingBubbleProps, "bottomOffset">,
) {
    const { floatingActionBottom } = useScreenOverlayInsets();
    return <FloatingBubble {...props} bottomOffset={floatingActionBottom} />;
}
