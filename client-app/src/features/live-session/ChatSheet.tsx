import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    TextInput,
    View,
} from "react-native";

import { BottomSheet } from "@/components/custom/bottom-sheet";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import {
    useMarkChatSeen,
    useSendSessionChat,
    useSessionChat,
    type OutgoingChatMessage,
    type SessionChatMessage,
} from "@/lib/routes/live-session-chat";
import { useAppTheme } from "@/lib/theme";
import { useKeyboardOverlap } from "@/lib/use-keyboard-overlap";
import { cn } from "@/lib/utils";

/** The most a message can hold. The backend checks the same. */
const MAX_MESSAGE_LENGTH = 1000;
/** Room under the composer, above the keyboard. */
const COMPOSER_GAP = 10;

type Row =
    | { kind: "sent"; message: SessionChatMessage }
    | { kind: "outgoing"; item: OutgoingChatMessage };

/**
 * A live session's chat, in a sheet over the player: everything said in the
 * session, newest at the bottom, and a field to say something. Anyone in the
 * session reads and writes it. A message shows at once and is marked if it
 * failed, with a tap to send it again.
 */
export function ChatSheet({
    sessionId,
    visible,
    onClose,
    onOpenProfile,
}: {
    sessionId: string;
    visible: boolean;
    onClose: () => void;
    onOpenProfile: (userId: string) => void;
}) {
    return (
        <BottomSheet
            visible={visible}
            onClose={onClose}
            title="Chat"
            heightFraction={0.75}
        >
            <ChatBody
                sessionId={sessionId}
                visible={visible}
                onOpenProfile={onOpenProfile}
            />
        </BottomSheet>
    );
}

function ChatBody({
    sessionId,
    visible,
    onOpenProfile,
}: {
    sessionId: string;
    visible: boolean;
    onOpenProfile: (userId: string) => void;
}) {
    const { account } = useAccount();
    const { colors } = useAppTheme();
    const chat = useSessionChat(sessionId);
    const { outgoing, send, retry, discard } = useSendSessionChat(sessionId);
    const [draft, setDraft] = useState("");
    const bodyRef = useRef<View>(null);
    const keyboardOverlap = useKeyboardOverlap(bodyRef);
    useMarkChatSeen(sessionId, chat.messages, visible);

    // newest first, for the inverted list: what is on its way, then the rest
    const rows: Row[] = [
        ...[...outgoing]
            .reverse()
            .map((item): Row => ({ kind: "outgoing", item })),
        ...chat.messages.map((message): Row => ({ kind: "sent", message })),
    ];
    const canSend = draft.trim().length > 0;

    function submit() {
        if (!canSend) return;
        send(draft);
        setDraft("");
    }

    return (
        <View ref={bodyRef} className="flex-1" collapsable={false}>
            {rows.length === 0 ? (
                <View className="flex-1 items-center justify-center px-8">
                    {chat.chatLoading ? (
                        <ActivityIndicator />
                    ) : (
                        <Text className="text-center text-muted-foreground">
                            {chat.chatError
                                ? "Couldn't load the chat."
                                : "No messages yet. Say something to everyone here."}
                        </Text>
                    )}
                </View>
            ) : (
                <FlatList
                    inverted
                    data={rows}
                    keyExtractor={(row) =>
                        row.kind === "sent"
                            ? String(row.message.message_id)
                            : row.item.key
                    }
                    renderItem={({ item: row, index }) => {
                        if (row.kind === "outgoing") {
                            return (
                                <OutgoingBubble
                                    item={row.item}
                                    onRetry={() => retry(row.item.key)}
                                    onDiscard={() => discard(row.item.key)}
                                />
                            );
                        }
                        // the row above, in time, is the next one in the data
                        const above = rows[index + 1];
                        const startsRun =
                            above?.kind !== "sent" ||
                            above.message.user_id !== row.message.user_id;
                        return (
                            <MessageBubble
                                message={row.message}
                                mine={row.message.user_id === account?.id}
                                showName={startsRun}
                                onOpenProfile={onOpenProfile}
                            />
                        );
                    }}
                    contentContainerClassName="gap-1.5 px-4 py-3"
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="interactive"
                    nestedScrollEnabled
                    onEndReached={chat.loadOlder}
                    onEndReachedThreshold={0.3}
                    ListFooterComponent={
                        chat.loadingOlder ? (
                            <ActivityIndicator className="py-3" />
                        ) : null
                    }
                />
            )}

            <View
                className="flex-row items-end gap-2 border-t border-border px-4 pt-3"
                style={{
                    paddingBottom:
                        keyboardOverlap > 0
                            ? keyboardOverlap + COMPOSER_GAP
                            : COMPOSER_GAP,
                }}
            >
                <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Message everyone"
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    maxLength={MAX_MESSAGE_LENGTH}
                    submitBehavior="blurAndSubmit"
                    returnKeyType="send"
                    onSubmitEditing={submit}
                    className="max-h-28 min-h-11 flex-1 rounded-3xl border border-border bg-background px-4 py-2.5 text-[16px] text-foreground"
                    accessibilityLabel="Message the session"
                />
                <Pressable
                    onPress={submit}
                    disabled={!canSend}
                    accessibilityRole="button"
                    accessibilityLabel="Send"
                    accessibilityState={{ disabled: !canSend }}
                    className="h-11 w-11 items-center justify-center rounded-full bg-brand active:opacity-70"
                    style={{ opacity: canSend ? 1 : 0.4 }}
                >
                    <Ionicons
                        name="arrow-up"
                        size={22}
                        color={colors.brandForeground}
                    />
                </Pressable>
            </View>
        </View>
    );
}

function sentTime(sentAt: string) {
    return new Date(sentAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
    });
}

function MessageBubble({
    message,
    mine,
    showName,
    onOpenProfile,
}: {
    message: SessionChatMessage;
    mine: boolean;
    showName: boolean;
    onOpenProfile: (userId: string) => void;
}) {
    const senderId = message.user_id;
    return (
        <View className={cn("max-w-[80%]", mine ? "self-end" : "self-start")}>
            {showName && !mine ? (
                <Pressable
                    disabled={!senderId}
                    onPress={() => senderId && onOpenProfile(senderId)}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${message.username}'s profile`}
                    className="mb-0.5 mt-2 px-3"
                >
                    <Text className="text-xs font-semibold text-muted-foreground">
                        {message.username}
                    </Text>
                </Pressable>
            ) : null}
            <View
                className={cn(
                    "rounded-2xl px-3 py-2",
                    mine ? "self-end bg-brand" : "self-start bg-muted",
                )}
            >
                <Text
                    className={cn(
                        "text-[15px]",
                        mine ? "text-brand-foreground" : "text-foreground",
                    )}
                >
                    {message.body}
                </Text>
            </View>
            <Text
                className={cn(
                    "mt-0.5 px-3 text-[10px] text-muted-foreground",
                    mine && "text-right",
                )}
            >
                {sentTime(message.sent_at)}
            </Text>
        </View>
    );
}

function OutgoingBubble({
    item,
    onRetry,
    onDiscard,
}: {
    item: OutgoingChatMessage;
    onRetry: () => void;
    onDiscard: () => void;
}) {
    return (
        <View className="max-w-[80%] self-end">
            <Pressable
                disabled={!item.failed}
                onPress={onRetry}
                accessibilityRole={item.failed ? "button" : undefined}
                accessibilityLabel={
                    item.failed ? `Send again: ${item.body}` : undefined
                }
                className="self-end rounded-2xl bg-brand px-3 py-2"
                style={{ opacity: item.failed ? 0.5 : 0.7 }}
            >
                <Text className="text-[15px] text-brand-foreground">
                    {item.body}
                </Text>
            </Pressable>
            {item.failed ? (
                <View className="mt-0.5 flex-row justify-end gap-3 px-3">
                    <Text className="text-[11px] text-destructive">
                        Not sent. Tap to send again.
                    </Text>
                    <Pressable
                        onPress={onDiscard}
                        accessibilityRole="button"
                        accessibilityLabel="Discard message"
                    >
                        <Text className="text-[11px] font-semibold text-muted-foreground">
                            Discard
                        </Text>
                    </Pressable>
                </View>
            ) : (
                <Text className="mt-0.5 px-3 text-right text-[10px] text-muted-foreground">
                    Sending
                </Text>
            )}
        </View>
    );
}
