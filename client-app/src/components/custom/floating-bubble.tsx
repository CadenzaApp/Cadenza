import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";

const DEFAULT_BOTTOM_OFFSET = 24;

type FloatingBubbleProps = {
    children: ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityState?: ComponentProps<
        typeof GlassIconButton
    >["accessibilityState"];
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
            <GlassIconButton
                size={56}
                style={{
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
            </GlassIconButton>
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
