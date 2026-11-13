import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Alert, Image, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import {
    SESSION_ROLE_LABELS,
    type LiveSessionEntry,
} from "@/lib/routes/live-sessions";
import { isUsableArtworkUrl } from "@/lib/utils";

export const ROLE_CHOICES = (
    ["listener", "suggester", "queue_editor", "controller"] as const
).map((value) => ({ value, label: SESSION_ROLE_LABELS[value] }));

/** The API's error type, like `Forbidden`, or undefined. */
export function errorType(error: unknown) {
    return (error as { error_type?: string } | null)?.error_type;
}

/** Runs a session write, and on failure says why in an alert. */
export async function runSessionWrite(
    action: () => Promise<unknown>,
    failure: string,
) {
    try {
        await action();
    } catch (error) {
        Alert.alert(
            "Live session",
            errorType(error) === "Forbidden"
                ? "Your role does not allow that."
                : failure,
        );
    }
}

const ANSWER_SIZE = 36;

/**
 * A red circle with an X and a green circle with a check, for turning
 * something down or letting it through: a join request or a suggestion.
 */
export function AnswerButtons({
    rejectLabel,
    acceptLabel,
    onReject,
    onAccept,
}: {
    rejectLabel: string;
    acceptLabel: string;
    onReject: () => void;
    onAccept: () => void;
}) {
    return (
        <View className="flex-row gap-3">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={rejectLabel}
                hitSlop={6}
                onPress={onReject}
                className="items-center justify-center rounded-full bg-destructive active:opacity-70"
                style={{ width: ANSWER_SIZE, height: ANSWER_SIZE }}
            >
                <Ionicons name="close" size={20} color="#ffffff" />
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={acceptLabel}
                hitSlop={6}
                onPress={onAccept}
                className="items-center justify-center rounded-full bg-success active:opacity-70"
                style={{ width: ANSWER_SIZE, height: ANSWER_SIZE }}
            >
                <Ionicons name="checkmark" size={20} color="#ffffff" />
            </Pressable>
        </View>
    );
}

/** A session song: art, title, artist, who added it, and `trailing`. */
export function EntryRow({
    entry,
    first,
    trailing,
}: {
    entry: LiveSessionEntry;
    first: boolean;
    trailing?: ReactNode;
}) {
    const by = entry.added_by_username
        ? ` · added by ${entry.added_by_username}`
        : "";
    return (
        <View className="h-16">
            {first ? null : (
                <View className="absolute left-[68px] right-0 top-0 h-px bg-border" />
            )}
            <View className="flex-1 flex-row items-center gap-3 px-4">
                {isUsableArtworkUrl(entry.artwork_url) ? (
                    <Image
                        source={{ uri: entry.artwork_url! }}
                        className="h-10 w-10 rounded-md bg-muted"
                    />
                ) : (
                    <View className="h-10 w-10 rounded-md bg-muted" />
                )}
                <View className="min-w-0 flex-1">
                    <Text
                        className="text-sm font-medium text-foreground"
                        numberOfLines={1}
                    >
                        {entry.title}
                    </Text>
                    <Text
                        className="text-xs text-muted-foreground"
                        numberOfLines={1}
                    >
                        {(entry.artist ?? "") + by}
                    </Text>
                </View>
                {trailing}
            </View>
        </View>
    );
}

export function OptionRow({
    label,
    destructive = false,
    onPress,
}: {
    label: string;
    destructive?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            className="rounded-lg px-3 py-3 active:opacity-60"
        >
            <Text
                className={
                    destructive
                        ? "text-base text-destructive"
                        : "text-base text-foreground"
                }
            >
                {label}
            </Text>
        </Pressable>
    );
}
