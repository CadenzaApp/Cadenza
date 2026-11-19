import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { DetailScreen } from "@/components/ui/detail-screen";
import { Text } from "@/components/ui/text";
import { getErrorMessage } from "@/lib/error-utils";
import { useAssistantActions } from "@/lib/routes/assistant-actions";
import { useAppTheme } from "@/lib/theme";

import {
    actionIcon,
    actionStatus,
    timeAgo,
    useUndoAndRecord,
} from "./action-card";
import type { AssistantAction } from "./types";

/** What a change was made to, the first words of its row's second line. */
const TARGET_LABELS: Record<
    NonNullable<AssistantAction["target"]>["kind"],
    string
> = {
    tag: "Tag",
    saved_query: "Saved query",
    shared_playlist: "Shared playlist",
    apple_music_playlist: "Apple Music",
};

/**
 * The assistant's activity log, a sheet over the chat: every change the user
 * confirmed in the assistant over the last 30 days, newest first, with Undo on
 * the ones that can still be undone. It is kept on the backend, so it outlives
 * the chat, a sign out, and a restart.
 */
export function AssistantActivityLog() {
    const { actions, actionsLoading, actionsErr, reloadActions } =
        useAssistantActions();

    return (
        <DetailScreen title="Assistant activity" presentation="sheet">
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-3 px-5 pb-10 pt-2"
                nestedScrollEnabled
            >
                <Text className="text-[13px] text-muted-foreground">
                    Changes you confirmed in the assistant, kept for 30 days.
                    Undo reverses only what the change did.
                </Text>
                {actionsLoading && !actions ? (
                    <ActivityIndicator className="py-8" />
                ) : actionsErr && !actions ? (
                    <View className="items-center gap-3 py-8">
                        <Text className="text-center text-[14px] text-muted-foreground">
                            Couldn&apos;t load the activity log.
                        </Text>
                        <Pressable
                            onPress={() => void reloadActions()}
                            accessibilityRole="button"
                            className="rounded-full bg-muted px-4 py-2 active:opacity-60"
                        >
                            <Text className="text-[14px] font-medium">
                                Try again
                            </Text>
                        </Pressable>
                    </View>
                ) : actions && actions.length > 0 ? (
                    <View className="overflow-hidden rounded-2xl border border-border bg-card">
                        {actions.map((action, index) => (
                            <ActivityRow
                                key={action.id}
                                action={action}
                                first={index === 0}
                            />
                        ))}
                    </View>
                ) : (
                    <View className="items-center gap-2 py-10">
                        <Text className="text-[16px] font-medium">
                            No changes yet
                        </Text>
                        <Text className="text-center text-[14px] text-muted-foreground">
                            When you have the assistant tag songs or change a
                            playlist, it shows up here.
                        </Text>
                    </View>
                )}
            </ScrollView>
        </DetailScreen>
    );
}

function ActivityRow({
    action,
    first,
}: {
    action: AssistantAction;
    first: boolean;
}) {
    const { colors } = useAppTheme();
    const { undo, undoing } = useUndoAndRecord();
    const [error, setError] = useState<string | null>(null);
    const canUndo = action.undoable && !action.undone;
    const where = action.target ? TARGET_LABELS[action.target.kind] : null;
    const status = action.undone
        ? actionStatus(action)
        : [where, actionStatus(action)].filter(Boolean).join(", ");

    const onUndo = async () => {
        setError(null);
        try {
            await undo(action);
        } catch (caught) {
            setError(getErrorMessage(caught));
        }
    };

    return (
        <View
            className={
                first
                    ? "gap-1 px-4 py-3"
                    : "gap-1 border-t border-border px-4 py-3"
            }
        >
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
                                ? "text-[14px] text-muted-foreground"
                                : "text-[14px]"
                        }
                        numberOfLines={2}
                    >
                        {action.summary}
                    </Text>
                    <Text
                        className="text-[12px] text-muted-foreground"
                        numberOfLines={2}
                    >
                        {action.undone
                            ? `${status}, ${timeAgo(action.created_at)}`
                            : status}
                    </Text>
                </View>
                {canUndo ? (
                    <Pressable
                        onPress={() => void onUndo()}
                        disabled={undoing}
                        accessibilityRole="button"
                        accessibilityLabel={`Undo: ${action.summary}`}
                        className="min-w-[56px] items-center rounded-full bg-muted px-3 py-1.5 active:opacity-60"
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
