import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";

import { SongResultsCard } from "./song-results-card";
import type { AssistantStep, ChatEntry } from "./types";

/** One message: the user's in a bubble on the right, the assistant's as plain text. */
export function MessageRow({ entry }: { entry: ChatEntry }) {
    if (entry.role === "user") {
        return (
            <View className="max-w-[85%] self-end rounded-3xl rounded-br-md bg-brand px-4 py-2.5">
                <Text className="text-[16px] text-brand-foreground">
                    {entry.text}
                </Text>
            </View>
        );
    }

    return (
        <View className="self-stretch">
            <StepRows steps={entry.steps} />
            <Text className="text-[16px] leading-6" selectable>
                {entry.text}
            </Text>
            {entry.songs ? <SongResultsCard songs={entry.songs} /> : null}
        </View>
    );
}

/** What the assistant did on the way, one muted line each. */
function StepRows({ steps }: { steps: AssistantStep[] }) {
    const { colors } = useAppTheme();
    if (steps.length === 0) return null;
    return (
        <View className="mb-1.5 gap-0.5">
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

/** Three pulsing dots while the assistant works. */
export function TypingIndicator() {
    return (
        <View
            className="flex-row items-center gap-1.5 self-start py-2"
            accessibilityLabel="The assistant is thinking"
        >
            <Dot delay={0} />
            <Dot delay={150} />
            <Dot delay={300} />
        </View>
    );
}

function Dot({ delay }: { delay: number }) {
    const opacity = useSharedValue(0.3);
    useEffect(() => {
        opacity.set(
            withDelay(
                delay,
                withRepeat(
                    withSequence(
                        withTiming(1, { duration: 400 }),
                        withTiming(0.3, { duration: 400 }),
                    ),
                    -1,
                ),
            ),
        );
    }, [delay, opacity]);
    const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
    return (
        <Animated.View
            className="h-2 w-2 rounded-full bg-muted-foreground"
            style={style}
        />
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
        <View className="flex-row items-center gap-3 self-stretch rounded-2xl border border-border px-4 py-3">
            <Ionicons
                name="alert-circle-outline"
                size={18}
                color={colors.destructive}
            />
            <Text className="flex-1 text-[14px]">{message}</Text>
            <Pressable
                onPress={onRetry}
                accessibilityRole="button"
                className="rounded-full bg-muted px-3 py-1.5 active:opacity-60"
            >
                <Text className="text-[13px] font-medium">Retry</Text>
            </Pressable>
        </View>
    );
}

const SUGGESTIONS = [
    "How many tags do I have?",
    "Who were my top artists this month?",
    "How much did I listen this week?",
    "What were my most played songs last week?",
];

/** The empty chat: what the assistant is for, and a few things to try. */
export function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
    const { colors } = useAppTheme();
    return (
        <View className="flex-1 justify-end gap-4 pb-2">
            <View className="items-center gap-2 px-6">
                <Ionicons name="sparkles" size={28} color={colors.brand} />
                <Text className="text-center text-[15px] text-muted-foreground">
                    Ask about your tags, your songs, or what you have been
                    listening to.
                </Text>
            </View>
            <View className="flex-row flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                    <Pressable
                        key={suggestion}
                        onPress={() => onPick(suggestion)}
                        accessibilityRole="button"
                        className="rounded-full border border-border px-3.5 py-2 active:opacity-60"
                    >
                        <Text className="text-[14px]">{suggestion}</Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}
