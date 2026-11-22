import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useId } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { GlassSurface } from "@/components/ui/glass-surface";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { usePressedFill } from "@/components/ui/pressed-fill";
import { Text } from "@/components/ui/text";
import { hexChannels } from "@/lib/color-math";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Small pieces the assistant sheet's glass look is built from. They read the
 * theme, so the user's accent, light or dark, and glass settings reach them.
 */

/** `#rrggbb` at `alpha`, as an rgba string. */
export function withAlpha(hex: string, alpha: number): string {
    const [r, g, b] = hexChannels(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A soft round glow of `color`, fading to nothing at its edge. */
export function Glow({
    size,
    color,
    strength = 0.5,
}: {
    size: number;
    color: string;
    strength?: number;
}) {
    // svg ids go in url(#id), which the characters useId makes can break
    const id = `assistantGlow${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
    return (
        <Svg width={size} height={size} pointerEvents="none">
            <Defs>
                <RadialGradient id={id} cx="50%" cy="50%" r="50%">
                    <Stop offset="0" stopColor={color} stopOpacity={strength} />
                    <Stop offset="1" stopColor={color} stopOpacity={0} />
                </RadialGradient>
            </Defs>
            <Rect width={size} height={size} fill={`url(#${id})`} />
        </Svg>
    );
}

/**
 * A value that swings from 0 to 1 and back forever, `duration` each way. Holds
 * at 0 while `active` is false or the user reduces motion.
 */
export function useBreathing(active: boolean, duration: number) {
    const reduceMotion = useReducedMotion();
    const progress = useSharedValue(0);
    useEffect(() => {
        if (!active || reduceMotion) {
            progress.set(0);
            return;
        }
        progress.set(
            withRepeat(
                withTiming(1, {
                    duration,
                    easing: Easing.inOut(Easing.quad),
                }),
                -1,
                true,
            ),
        );
        return () => cancelAnimation(progress);
    }, [active, duration, progress, reduceMotion]);
    return progress;
}

const AVATAR_SIZE = 26;
const AVATAR_GLOW = 64;

/**
 * The assistant's mark beside its replies: a sparkle on a disc of the accent.
 * `glowing` pulses a glow around it, while the assistant works.
 */
export function SparkleAvatar({ glowing = false }: { glowing?: boolean }) {
    const { colors } = useAppTheme();
    const pulse = useBreathing(glowing, 800);
    const glowStyle = useAnimatedStyle(() => ({
        opacity: 0.45 + pulse.get() * 0.55,
        transform: [{ scale: 0.8 + pulse.get() * 0.35 }],
    }));

    return (
        <View
            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
        >
            {glowing ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        {
                            position: "absolute",
                            left: (AVATAR_SIZE - AVATAR_GLOW) / 2,
                            top: (AVATAR_SIZE - AVATAR_GLOW) / 2,
                        },
                        glowStyle,
                    ]}
                >
                    <Glow size={AVATAR_GLOW} color={colors.brand} />
                </Animated.View>
            ) : null}
            <View
                className="items-center justify-center rounded-full"
                style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: withAlpha(colors.brand, 0.18) },
                ]}
            >
                <Ionicons name="sparkles" size={14} color={colors.brand} />
            </View>
        </View>
    );
}

/**
 * An icon on a small rounded square of the accent, the lead of a suggestion
 * tile or a done card. `muted` grays it, for a change that was undone.
 */
export function IconTile({
    icon,
    muted = false,
}: {
    icon: IoniconName;
    muted?: boolean;
}) {
    const { colors } = useAppTheme();
    const color = muted ? colors.mutedForeground : colors.brand;
    return (
        <View
            className="h-8 w-8 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: withAlpha(color, muted ? 0.14 : 0.18) }}
        >
            <Ionicons name={icon} size={17} color={color} />
        </View>
    );
}

/** A thin rule between parts of a glass card. */
export function Hairline({ className }: { className?: string }) {
    const { colors } = useAppTheme();
    return (
        <View
            className={className}
            style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: withAlpha(colors.foreground, 0.14),
            }}
        />
    );
}

const CARD_BUTTON_HEIGHT = 36;

/**
 * A rounded button on a glass card. `glass` is the card's own glass a step
 * brighter (glass on glass paints a flat wash); `brand` is solid accent, for
 * the card's main action. `grow` lets two share a row evenly. Pressing it
 * shrinks it a little and shades it, since native glass does not fade.
 */
export function CardButton({
    label,
    icon,
    onPress,
    tone = "glass",
    loading = false,
    disabled = false,
    grow = false,
    accessibilityLabel,
}: {
    label: string;
    icon?: IoniconName;
    onPress: () => void;
    tone?: "glass" | "brand";
    loading?: boolean;
    disabled?: boolean;
    grow?: boolean;
    accessibilityLabel?: string;
}) {
    const { colors } = useAppTheme();
    const pressedFill = usePressedFill();
    const brand = tone === "brand";
    const foreground = brand ? colors.brandForeground : colors.foreground;

    return (
        <Pressable
            onPress={onPress}
            disabled={disabled || loading}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled, busy: loading }}
            hitSlop={4}
            style={grow ? { flex: 1 } : undefined}
        >
            {({ pressed }) => (
                <View
                    collapsable={false}
                    className="flex-row items-center justify-center gap-1.5 overflow-hidden px-4"
                    style={{
                        height: CARD_BUTTON_HEIGHT,
                        borderRadius: CARD_BUTTON_HEIGHT / 2,
                        backgroundColor: brand ? colors.brand : undefined,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                    }}
                >
                    {brand ? null : (
                        <View
                            pointerEvents="none"
                            style={StyleSheet.absoluteFill}
                        >
                            <GlassSurface
                                variant="regular"
                                style={[
                                    StyleSheet.absoluteFill,
                                    { borderRadius: CARD_BUTTON_HEIGHT / 2 },
                                ]}
                            />
                        </View>
                    )}
                    {pressed ? (
                        <View
                            pointerEvents="none"
                            style={[
                                StyleSheet.absoluteFill,
                                {
                                    backgroundColor: withAlpha(
                                        pressedFill,
                                        0.14,
                                    ),
                                },
                            ]}
                        />
                    ) : null}
                    <View
                        className={cn(
                            "flex-row items-center gap-1.5",
                            disabled && !loading && "opacity-40",
                        )}
                    >
                        {loading ? (
                            <ActivityIndicator
                                size="small"
                                color={foreground}
                            />
                        ) : icon ? (
                            <Ionicons
                                name={icon}
                                size={15}
                                color={foreground}
                            />
                        ) : null}
                        <Text
                            className="text-[14px] font-semibold"
                            style={{ color: foreground }}
                            numberOfLines={1}
                        >
                            {label}
                        </Text>
                    </View>
                </View>
            )}
        </Pressable>
    );
}
