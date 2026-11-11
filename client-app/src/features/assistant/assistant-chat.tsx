import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { useAppTheme } from "@/lib/theme";

import { EmptyChat, ErrorRow, MessageRow, TypingIndicator } from "./chat-parts";
import { useAssistantChat } from "./use-assistant-chat";

/** The most a user can type into one message. The backend cuts at 4000. */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * The assistant sheet: the conversation, newest at the bottom, and a field to
 * ask the next question. A plain ScrollView rather than a FlashList, since a
 * chat holds a few dozen messages at most and stays pinned to its end.
 */
export function AssistantChat() {
    const { colors } = useAppTheme();
    const insets = useSafeAreaInsets();
    const { entries, sending, error, send, retry, reset } = useAssistantChat();
    const [draft, setDraft] = useState("");
    const scrollRef = useRef<ScrollView>(null);

    const submit = (text: string) => {
        if (!text.trim() || sending) return;
        send(text);
        setDraft("");
    };

    const canSend = draft.trim().length > 0 && !sending;

    return (
        <DetailScreen
            title="Assistant"
            presentation="sheet"
            headerRight={
                entries.length > 0 ? (
                    <GlassIconButton
                        bordered={false}
                        accessibilityLabel="New chat"
                        onPress={reset}
                    >
                        <Ionicons
                            name="create-outline"
                            size={21}
                            color={colors.foreground}
                        />
                    </GlassIconButton>
                ) : null
            }
        >
            <KeyboardAvoidingView
                className="flex-1"
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
            >
                <ScrollView
                    ref={scrollRef}
                    className="flex-1"
                    contentContainerClassName="grow gap-4 px-5 pb-4 pt-2"
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="interactive"
                    onContentSizeChange={() =>
                        scrollRef.current?.scrollToEnd({ animated: true })
                    }
                >
                    {entries.length === 0 && !sending ? (
                        <EmptyChat onPick={submit} />
                    ) : (
                        entries.map((entry) => (
                            <MessageRow key={entry.id} entry={entry} />
                        ))
                    )}
                    {sending ? <TypingIndicator /> : null}
                    {error && !sending ? (
                        <ErrorRow message={error} onRetry={retry} />
                    ) : null}
                </ScrollView>

                <View
                    className="flex-row items-end gap-2 border-t border-border px-4 pt-2.5"
                    style={{ paddingBottom: Math.max(insets.bottom, 12) }}
                >
                    <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        placeholder="Ask about your music"
                        placeholderTextColor={colors.mutedForeground}
                        multiline
                        maxLength={MAX_MESSAGE_LENGTH}
                        submitBehavior="blurAndSubmit"
                        returnKeyType="send"
                        onSubmitEditing={() => submit(draft)}
                        className="max-h-32 min-h-11 flex-1 rounded-3xl border border-border bg-card px-4 py-2.5 text-[16px] text-foreground"
                        accessibilityLabel="Message the assistant"
                    />
                    <Pressable
                        onPress={() => submit(draft)}
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
            </KeyboardAvoidingView>
        </DetailScreen>
    );
}
