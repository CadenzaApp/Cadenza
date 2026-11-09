import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Platform, StyleSheet } from "react-native";
import Animated, {
    interpolate,
    useAnimatedStyle,
    type SharedValue,
} from "react-native-reanimated";

import { useAppTheme } from "@/lib/theme";

/** How far past `height` the blur fades out, so it has no hard edge. */
const FADE = 24;

/** Scroll distance over which the blur fades in. */
const REVEAL_DISTANCE = 16;

/**
 * A blur behind a floating header that fades to nothing at its bottom edge,
 * the way an iOS bar softens content scrolling under it. It shows once
 * `scrollOffset` moves off the top, so a page at rest keeps its backdrop.
 *
 * Android has no live blur here, so it fades the background color instead.
 */
export function ScrollEdgeBlur({
    height,
    scrollOffset,
}: {
    /** The header's height. The fade runs below it. */
    height: number;
    scrollOffset: SharedValue<number>;
}) {
    const { scheme, colors } = useAppTheme();
    const total = height + FADE;
    // solid behind the header, clear at the end of the fade
    const solidUntil = height / total;

    const revealStyle = useAnimatedStyle(() => ({
        opacity: interpolate(
            scrollOffset.get(),
            [0, REVEAL_DISTANCE],
            [0, 1],
            "clamp",
        ),
    }));

    return (
        <Animated.View
            pointerEvents="none"
            style={[
                {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: total,
                },
                revealStyle,
            ]}
        >
            {Platform.OS === "ios" ? (
                <MaskedView
                    style={StyleSheet.absoluteFill}
                    maskElement={
                        <LinearGradient
                            colors={["black", "black", "transparent"]}
                            locations={[0, solidUntil * 0.6, 1]}
                            style={StyleSheet.absoluteFill}
                        />
                    }
                >
                    <BlurView
                        intensity={40}
                        tint={
                            scheme === "dark"
                                ? "systemThinMaterialDark"
                                : "systemThinMaterialLight"
                        }
                        style={StyleSheet.absoluteFill}
                    />
                </MaskedView>
            ) : (
                <LinearGradient
                    colors={[
                        colors.background,
                        `${colors.background}E6`,
                        `${colors.background}00`,
                    ]}
                    locations={[0, solidUntil, 1]}
                    style={StyleSheet.absoluteFill}
                />
            )}
        </Animated.View>
    );
}
