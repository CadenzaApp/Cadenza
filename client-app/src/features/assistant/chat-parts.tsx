import Ionicons from "@expo/vector-icons/Ionicons";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    interpolate,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import { GlassPanel } from "@/components/ui/glass-panel";
import {
    GlassSurface,
    shouldShowGlassOutline,
} from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { ActionCard } from "./action-card";
import {
    CardButton,
    Glow,
    SparkleAvatar,
    useBreathing,
    withAlpha,
} from "./assistant-ui";
import { SongResultsCard } from "./song-results-card";
import { SuggestionWheel } from "./suggestion-wheel";
import type { AssistantStep, ChatEntry, PendingConfirmation } from "./types";

/**
 * One message: the user's in a bubble of their accent on the right, the
 * assistant's as plain text under its sparkle, with any song card and done
 * cards below it.
 */
export function MessageRow({ entry }: { entry: ChatEntry }) {
    const { colors } = useAppTheme();
    if (entry.role === "user") {
        // a little translucent, so the nebula glows through. Not glass: a
        // long scroll of liquid glass views is costly, and the color is the
        // point here
        return (
            <View className="max-w-[82%] gap-1 self-end">
                <View
                    className="rounded-3xl rounded-br-md px-4 py-2.5"
                    style={{ backgroundColor: withAlpha(colors.brand, 0.85) }}
                >
                    <Text
                        className="text-[16px] leading-[22px]"
                        style={{ color: colors.brandForeground }}
                        selectable
                    >
                        {entry.text}
                    </Text>
                </View>
                {entry.stopped ? (
                    <Text className="self-end text-right text-[13px] text-muted-foreground">
                        {entry.stopped === "stopped_after_change"
                            ? "Stopped. A change you confirmed may still have gone through; check the activity log."
                            : "Stopped"}
                    </Text>
                ) : null}
            </View>
        );
    }
    return <AssistantMessage entry={entry} />;
}

function AssistantMessage({
    entry,
}: {
    entry: Extract<ChatEntry, { role: "assistant" }>;
}) {
    const [stepsOpen, setStepsOpen] = useState(false);
    return (
        <View className="gap-2.5 self-stretch">
            <View className="flex-row items-center gap-2">
                <SparkleAvatar />
                {entry.steps.length > 0 ? (
                    <StepsPill
                        steps={entry.steps}
                        open={stepsOpen}
                        onToggle={() => setStepsOpen((open) => !open)}
                    />
                ) : null}
            </View>
            {stepsOpen ? <StepList steps={entry.steps} /> : null}
            <Text className="text-[16px] leading-6" selectable>
                {entry.text}
            </Text>
            {entry.songs ? <SongResultsCard songs={entry.songs} /> : null}
            {entry.actions?.map((action) => (
                <ActionCard key={action.id} action={action} />
            ))}
        </View>
    );
}

/**
 * What the assistant did on the way, folded into one small glass pill: the
 * step itself when there was one, a count when there were more. Tapping it
 * lists them under it.
 */
function StepsPill({
    steps,
    open,
    onToggle,
}: {
    steps: AssistantStep[];
    open: boolean;
    onToggle: () => void;
}) {
    const { colors } = useAppTheme();
    const outlined = shouldShowGlassOutline();
    const summary =
        steps.length === 1 ? steps[0].label : `${steps.length} steps`;
    return (
        <Pressable
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityLabel={`${open ? "Hide" : "Show"} what the assistant did`}
            accessibilityState={{ expanded: open }}
            hitSlop={6}
            className="active:opacity-60"
        >
            <View
                className={cn(
                    "h-7 flex-row items-center gap-1 overflow-hidden rounded-full pl-2.5 pr-2",
                    outlined && "border border-border",
                )}
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="clear"
                        style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
                    />
                </View>
                <Ionicons
                    name="checkmark"
                    size={13}
                    color={colors.mutedForeground}
                />
                <Text
                    className="text-[13px] text-muted-foreground"
                    numberOfLines={1}
                >
                    {summary}
                </Text>
                <Ionicons
                    name={open ? "chevron-up" : "chevron-down"}
                    size={12}
                    color={colors.mutedForeground}
                />
            </View>
        </Pressable>
    );
}

/** The steps, one muted line each, once the pill is open. */
function StepList({ steps }: { steps: AssistantStep[] }) {
    const { colors } = useAppTheme();
    return (
        <View className="ml-[34px] gap-1">
            {steps.map((step, index) => (
                <View
                    key={`${step.tool}-${index}`}
                    className="flex-row items-center gap-1.5"
                >
                    <Ionicons
                        name="checkmark-circle-outline"
                        size={14}
                        color={colors.mutedForeground}
                    />
                    <Text className="text-[13px] text-muted-foreground">
                        {step.label}
                    </Text>
                </View>
            ))}
        </View>
    );
}

/**
 * A change waiting for the user's yes: a phone tool that changes their Apple
 * Music library, or a change the backend makes (tags, saved queries,
 * playlists). What it will do, Cancel, and the action itself.
 */
export function ConfirmCard({
    confirmation,
    onAnswer,
}: {
    confirmation: PendingConfirmation;
    onAnswer: (confirmed: boolean) => void;
}) {
    return (
        <GlassPanel className="self-stretch">
            <View className="gap-4 p-4">
                <View className="gap-1">
                    <Text className="text-[16px] font-semibold">
                        {confirmation.title}
                    </Text>
                    <Text className="text-[14px] leading-5 text-muted-foreground">
                        {confirmation.detail}
                    </Text>
                </View>
                <View className="flex-row gap-2">
                    <CardButton
                        grow
                        label="Cancel"
                        onPress={() => onAnswer(false)}
                    />
                    <CardButton
                        grow
                        tone="brand"
                        label={confirmation.confirmLabel}
                        onPress={() => onAnswer(true)}
                    />
                </View>
            </View>
        </GlassPanel>
    );
}

/** The sparkle glowing, and "Thinking…" with light sweeping across it. */
export function ThinkingIndicator() {
    return (
        <View
            className="flex-row items-center gap-2.5 self-start py-1"
            accessible
            accessibilityLabel="The assistant is thinking"
        >
            <SparkleAvatar glowing />
            <ShimmerText text="Thinking…" />
        </View>
    );
}

/** How long one sweep of light takes to cross the text. */
const SHIMMER_MS = 1600;

/**
 * Muted text with a band of the foreground color sweeping across it, left to
 * right, over and over. Plain muted text under reduced motion.
 */
function ShimmerText({ text }: { text: string }) {
    const { colors } = useAppTheme();
    const reduceMotion = useReducedMotion();
    const [width, setWidth] = useState(0);
    const progress = useSharedValue(0);

    useEffect(() => {
        if (reduceMotion || width === 0) return;
        progress.set(0);
        progress.set(
            withRepeat(
                withTiming(1, { duration: SHIMMER_MS, easing: Easing.linear }),
                -1,
                false,
            ),
        );
        return () => cancelAnimation(progress);
    }, [progress, reduceMotion, width]);

    const sweep = useAnimatedStyle(() => ({
        transform: [
            {
                translateX: interpolate(
                    progress.get(),
                    [0, 1],
                    [-width, width],
                ),
            },
        ],
    }));

    const className = "text-[15px] font-medium";
    if (reduceMotion) {
        return (
            <Text className={cn(className, "text-muted-foreground")}>
                {text}
            </Text>
        );
    }
    return (
        <MaskedView
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            maskElement={<Text className={className}>{text}</Text>}
        >
            <View style={{ backgroundColor: colors.mutedForeground }}>
                {/* sizes the mask; the color comes from the views around it */}
                <Text className={className} style={{ opacity: 0 }}>
                    {text}
                </Text>
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, sweep]}
                >
                    <LinearGradient
                        colors={[
                            withAlpha(colors.foreground, 0),
                            colors.foreground,
                            withAlpha(colors.foreground, 0),
                        ]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={StyleSheet.absoluteFill}
                    />
                </Animated.View>
            </View>
        </MaskedView>
    );
}

/** The failed send, with a way to try again. */
export function ErrorRow({
    message,
    onRetry,
}: {
    message: string;
    onRetry: () => void;
}) {
    const { colors } = useAppTheme();
    return (
        <GlassPanel className="self-stretch">
            <View className="flex-row items-center gap-3 py-3 pl-4 pr-3">
                <Ionicons
                    name="alert-circle-outline"
                    size={20}
                    color={colors.destructive}
                />
                <Text className="flex-1 text-[14px]">{message}</Text>
                <CardButton label="Retry" icon="refresh" onPress={onRetry} />
            </View>
        </GlassPanel>
    );
}

/**
 * The empty chat: a glowing sparkle, what the assistant is for, and a wheel of
 * things to try. A tap on one hands it to `onPick`, which puts it in the
 * composer to send or edit.
 */
export function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
    return (
        <View className="flex-1 justify-between gap-6 pb-1">
            <View className="flex-1 items-center justify-center gap-4 px-4">
                <HeroOrb />
                <Text className="text-center text-[26px] font-bold leading-8 tracking-tight">
                    What can I do for your music?
                </Text>
                <Text className="max-w-[310px] text-center text-[15px] leading-5 text-muted-foreground">
                    Ask about your listening, find and play songs, or have me
                    tag, save, and organize your library.
                </Text>
            </View>
            <View className="gap-1">
                <Text className="text-center text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Try asking
                </Text>
                <SuggestionWheel onPick={onPick} />
            </View>
        </View>
    );
}

const ORB_SIZE = 88;
const ORB_GLOW = 200;

/** A glass disc holding the sparkle, with the accent breathing behind it. */
function HeroOrb() {
    const { colors } = useAppTheme();
    const outlined = shouldShowGlassOutline();
    const breath = useBreathing(true, 2000);
    const glowStyle = useAnimatedStyle(() => ({
        opacity: 0.7 + breath.get() * 0.3,
        transform: [{ scale: 0.92 + breath.get() * 0.16 }],
    }));

    return (
        <View
            style={{ width: ORB_SIZE, height: ORB_SIZE }}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
        >
            <Animated.View
                pointerEvents="none"
                style={[
                    {
                        position: "absolute",
                        left: (ORB_SIZE - ORB_GLOW) / 2,
                        top: (ORB_SIZE - ORB_GLOW) / 2,
                    },
                    glowStyle,
                ]}
            >
                <Glow size={ORB_GLOW} color={colors.brand} strength={0.55} />
            </Animated.View>
            <View
                className={cn(
                    "flex-1 items-center justify-center overflow-hidden rounded-full",
                    outlined && "border border-border",
                )}
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="regular"
                        style={[
                            StyleSheet.absoluteFill,
                            { borderRadius: ORB_SIZE / 2 },
                        ]}
                    />
                </View>
                <Ionicons name="sparkles" size={40} color={colors.brand} />
            </View>
        </View>
    );
}
