import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { getErrorMessage } from "@/lib/error-utils";
import { useUndoAssistantAction } from "@/lib/routes/assistant-actions";
import { useAppTheme } from "@/lib/theme";

import { updateConversation } from "./assistant-store";
import type { AssistantAction } from "./types";

/** The icon a change shows, by what it changed. */
export function actionIcon(action: AssistantAction) {
    if (action.undone) return "arrow-undo-outline" as const;
    switch (action.target?.kind) {
        case "saved_query":
            return "search-outline" as const;
        case "shared_playlist":
        case "apple_music_playlist":
            return "musical-notes-outline" as const;
        default:
            return "pricetag-outline" as const;
    }
}

/** How long ago a change was made, in a few words. */
export function timeAgo(createdAt: string, now = Date.now()): string {
    const then = Date.parse(createdAt);
    if (!Number.isFinite(then)) return "";
    const minutes = Math.max(0, Math.round((now - then) / 60_000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "Yesterday" : `${days} days ago`;
}

/** What a log row or done card says under its summary. */
export function actionStatus(action: AssistantAction): string {
    if (action.undone) return action.undo_result ?? "Undone";
    if (!action.undoable) return "Can't be undone in Cadenza";
    return timeAgo(action.created_at);
}

/**
 * Undoes `action` and keeps every copy of it in the chat in step: the done
 * card under the answer and its status. Returns the undo's message, or throws.
 */
export function useUndoAndRecord() {
    const { account } = useAccount();
    const accountId = account?.id ?? null;
    const { undoAction, undoing } = useUndoAssistantAction();
    const undo = async (action: AssistantAction) => {
        const result = await undoAction(action);
        updateConversation(accountId, (current) => ({
            entries: current.entries.map((entry) =>
                entry.role === "assistant" && entry.actions
                    ? {
                          ...entry,
                          actions: entry.actions.map((item) =>
                              item.id === action.id ? result.action : item,
                          ),
                      }
                    : entry,
            ),
        }));
        return result;
    };
    return { undo, undoing };
}

/**
 * A change the assistant made in this answer: what it did, and Undo while it
 * can still be undone. After an undo it says what the undo did.
 */
export function ActionCard({ action }: { action: AssistantAction }) {
    const { colors } = useAppTheme();
    const { undo, undoing } = useUndoAndRecord();
    const [error, setError] = useState<string | null>(null);
    const canUndo = action.undoable && !action.undone;

    const onUndo = async () => {
        setError(null);
        try {
            await undo(action);
        } catch (caught) {
            setError(getErrorMessage(caught));
        }
    };

    return (
        <View className="mt-3 gap-1.5 self-stretch rounded-2xl border border-border bg-card px-4 py-3">
            <View className="flex-row items-center gap-3">
                <Ionicons
                    name={actionIcon(action)}
                    size={20}
                    color={colors.mutedForeground}
                />
                <View className="min-w-0 flex-1">
                    <Text
                        className={
                            action.undone
                                ? "text-[14px] font-medium text-muted-foreground"
                                : "text-[14px] font-medium"
                        }
                        numberOfLines={2}
                    >
                        {action.undone ? "Undone" : action.summary}
                    </Text>
                    <Text className="text-[13px] text-muted-foreground">
                        {action.undone
                            ? (action.undo_result ?? action.summary)
                            : actionStatus(action)}
                    </Text>
                </View>
                {canUndo ? (
                    <Pressable
                        onPress={() => void onUndo()}
                        disabled={undoing}
                        accessibilityRole="button"
                        accessibilityLabel={`Undo: ${action.summary}`}
                        className="min-w-[64px] items-center rounded-full bg-muted px-3.5 py-1.5 active:opacity-60"
                    >
                        {undoing ? (
                            <ActivityIndicator size="small" />
                        ) : (
                            <Text className="text-[13px] font-medium">
                                Undo
                            </Text>
                        )}
                    </Pressable>
                ) : null}
            </View>
            {error ? (
                <Text className="text-[13px] text-destructive">{error}</Text>
            ) : null}
        </View>
    );
}
