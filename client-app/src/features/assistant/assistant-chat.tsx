import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Dimensions,
    Keyboard,
    Platform,
    Pressable,
    ScrollView,
    TextInput,
    View,
    type KeyboardEvent,
    type LayoutChangeEvent,
} from "react-native";

import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { useAppTheme } from "@/lib/theme";

import { answerConfirmation } from "./assistant-store";
import {
    ConfirmCard,
    EmptyChat,
    ErrorRow,
    MessageRow,
    TypingIndicator,
} from "./chat-parts";
import { PlaybackSnapshotBridge } from "./playback-snapshot";
import { useAssistantChat } from "./use-assistant-chat";
import { keyboardOverlap } from "./keyboard-overlap";

/** The most a user can type into one message. The backend cuts at 4000. */
const MAX_MESSAGE_LENGTH = 2000;
/** Room under the composer, above the home indicator or the keyboard. */
const COMPOSER_BOTTOM_GAP = 10;

/**
 * The assistant sheet: the conversation, newest at the bottom, and a field to
 * ask the next question. A plain ScrollView rather than a FlashList, since a
 * chat holds a few dozen messages at most and stays pinned to its end.
 */
export function AssistantChat() {
    const { colors } = useAppTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { entries, sending, error, confirmation, send, retry, reset } =
        useAssistantChat();
    const [draft, setDraft] = useState("");
    const scrollRef = useRef<ScrollView>(null);
    const {
        overlap: keyboardOverlap,
        onLayout: onBodyLayout,
        onFocus,
    } = useKeyboardOverlap();

    // keep the newest message in view as the keyboard pushes the field up
    useEffect(() => {
        if (keyboardOverlap > 0)
            scrollRef.current?.scrollToEnd({ animated: true });
    }, [keyboardOverlap]);

    const submit = (text: string) => {
        if (!text.trim() || sending) return;
        send(text);
        setDraft("");
    };

    const canSend = draft.trim().length > 0 && !sending;
    const composerBottom =
        keyboardOverlap > 0
            ? keyboardOverlap + COMPOSER_BOTTOM_GAP
            : Math.max(insets.bottom, 12) + COMPOSER_BOTTOM_GAP;

    return (
        <DetailScreen
            title="AI Assistant"
            presentation="sheet"
            headerRight={
                <View className="flex-row items-center gap-1">
                    <GlassIconButton
                        bordered={false}
                        accessibilityLabel="Assistant activity"
                        onPress={() =>
                            router.push("/assistant-activity" as Href)
                        }
                    >
                        <Ionicons
                            name="time-outline"
                            size={22}
                            color={colors.foreground}
                        />
                    </GlassIconButton>
                    {entries.length > 0 ? (
                        <GlassIconButton
                            bordered={false}
                            accessibilityLabel="Clear chat"
                            onPress={reset}
                        >
                            <Ionicons
                                name="trash-outline"
                                size={21}
                                color={colors.foreground}
                            />
                        </GlassIconButton>
                    ) : null}
                </View>
            }
        >
            <PlaybackSnapshotBridge />
            <View className="flex-1" onLayout={onBodyLayout}>
                <ScrollView
                    ref={scrollRef}
                    className="flex-1"
                    contentContainerClassName="grow gap-4 px-5 pb-4 pt-2"
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="interactive"
                    // Android: makes this the list the sheet hands vertical
                    // drags to. It scrolls first, and once it is at the top
                    // (or too short to scroll) the drag moves the sheet.
                    nestedScrollEnabled
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
                    {confirmation ? (
                        <ConfirmCard
                            confirmation={confirmation}
                            onAnswer={answerConfirmation}
                        />
                    ) : sending ? (
                        <TypingIndicator />
                    ) : null}
                    {error && !sending ? (
                        <ErrorRow message={error} onRetry={retry} />
                    ) : null}
                </ScrollView>

                <View
                    className="flex-row items-end gap-2 border-t border-border px-4 pt-3"
                    style={{ paddingBottom: composerBottom }}
                >
                    <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        onFocus={onFocus}
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
            </View>
        </DetailScreen>
    );
}

/** Keeps the bottom-aligned sheet's composer above the keyboard. */
function useKeyboardOverlap() {
    const [overlap, setOverlap] = useState(0);
    const restingHeight = useRef(0);
    const bodyHeight = useRef(0);
    const keyboardHeight = useRef(0);
    const opening = useRef(false);

    const updateOverlap = useCallback(() => {
        setOverlap(
            keyboardOverlap(
                keyboardHeight.current,
                restingHeight.current,
                bodyHeight.current,
            ),
        );
    }, []);

    const onLayout = useCallback(
        (event: LayoutChangeEvent) => {
            bodyHeight.current = event.nativeEvent.layout.height;
            if (keyboardHeight.current === 0 && !opening.current) {
                restingHeight.current = bodyHeight.current;
            }
            updateOverlap();
        },
        [updateOverlap],
    );

    const onFocus = useCallback(() => {
        if (keyboardHeight.current === 0) {
            restingHeight.current = bodyHeight.current;
            opening.current = true;
        }
    }, []);

    useEffect(() => {
        const ios = Platform.OS === "ios";
        const change = (event: KeyboardEvent) => {
            const { height, screenY } = event.endCoordinates;
            // Both values here are screen measurements. A sheet's local
            // measureInWindow origin need not match the keyboard's origin.
            keyboardHeight.current = Math.max(
                0,
                Math.min(height, Dimensions.get("screen").height - screenY),
            );
            opening.current = keyboardHeight.current > 0;
            if (ios) Keyboard.scheduleLayoutAnimation(event);
            updateOverlap();
        };
        const hide = (event: KeyboardEvent) => {
            keyboardHeight.current = 0;
            opening.current = false;
            if (ios) Keyboard.scheduleLayoutAnimation(event);
            updateOverlap();
        };
        const changed = Keyboard.addListener(
            ios ? "keyboardWillChangeFrame" : "keyboardDidShow",
            change,
        );
        const hidden = Keyboard.addListener(
            ios ? "keyboardWillHide" : "keyboardDidHide",
            hide,
        );
        const metrics = Keyboard.metrics();
        if (metrics) {
            keyboardHeight.current = metrics.height;
            updateOverlap();
        }
        return () => {
            changed.remove();
            hidden.remove();
        };
    }, [updateOverlap]);

    return { overlap, onLayout, onFocus };
}
