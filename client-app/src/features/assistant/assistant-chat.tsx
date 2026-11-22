import Ionicons from "@expo/vector-icons/Ionicons";
import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Dimensions,
    Keyboard,
    Platform,
    Pressable,
    StyleSheet,
    TextInput,
    View,
    type KeyboardEvent,
    type LayoutChangeEvent,
} from "react-native";
import Animated, {
    FadeIn,
    FadeInDown,
    interpolate,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import {
    GlassSurface,
    shouldShowGlassOutline,
} from "@/components/ui/glass-surface";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { assistantNebulaColors } from "./assistant-nebula";
import { answerConfirmation } from "./assistant-store";
import {
    ConfirmCard,
    EmptyChat,
    ErrorRow,
    MessageRow,
    ThinkingIndicator,
} from "./chat-parts";
import { PlaybackSnapshotBridge } from "./playback-snapshot";
import { useAssistantChat } from "./use-assistant-chat";
import { keyboardOverlap } from "./keyboard-overlap";

/** The most a user can type into one message. The backend cuts at 4000. */
const MAX_MESSAGE_LENGTH = 2000;
/** Room under the composer, above the home indicator or the keyboard. */
const COMPOSER_BOTTOM_GAP = 10;
/** The composer on one line, until its real height is measured. */
const COMPOSER_MIN_HEIGHT = 52;
/** Space between the composer and the sheet's sides. */
const COMPOSER_SIDE_GAP = 14;
/** Room between the last message and the composer floating over the list. */
const COMPOSER_CLEARANCE = 18;
/** How far above the composer the blur under it fades out. */
const EDGE_BLUR_FADE = 36;
/** How long a new message takes to rise into place. */
const ENTER_MS = 280;

/**
 * The assistant sheet: the conversation, newest at the bottom, and a field to
 * ask the next question. A plain ScrollView rather than a FlashList, since a
 * chat holds a few dozen messages at most and stays pinned to its end.
 *
 * Over a nebula in the user's accent, with the composer floating on glass at
 * the bottom. The list runs under the composer, which blurs what passes
 * beneath it.
 */
export function AssistantChat() {
    const { colors } = useAppTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { entries, sending, error, confirmation, send, retry, reset } =
        useAssistantChat();
    const [draft, setDraft] = useState("");
    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
    const nebula = useMemo(
        () => assistantNebulaColors(colors.brand),
        [colors.brand],
    );
    // Only messages that arrive while the sheet is open rise in. Reopening it
    // shows the conversation as it was, with nothing animating.
    const [shownAtOpen] = useState(
        () => new Set(entries.map((entry) => entry.id)),
    );
    const {
        overlap: keyboardOverlap,
        onLayout: onBodyLayout,
        onFocus,
    } = useKeyboardOverlap();

    // How much of the list is out of sight below its bottom edge, so the blur
    // under the composer shows only while something is under it.
    const hiddenBelow = useSharedValue(0);
    const onScroll = useAnimatedScrollHandler((event) => {
        hiddenBelow.set(
            event.contentSize.height -
                event.layoutMeasurement.height -
                event.contentOffset.y,
        );
    });

    // keep the newest message in view as the keyboard pushes the field up
    useEffect(() => {
        if (keyboardOverlap > 0)
            scrollRef.current?.scrollToEnd({ animated: true });
    }, [keyboardOverlap, scrollRef]);

    // a light tap when an answer lands, not for the ones already there
    const last = entries.at(-1);
    const newAnswerId =
        last?.role === "assistant" && !shownAtOpen.has(last.id)
            ? last.id
            : null;
    useEffect(() => {
        if (newAnswerId) void Haptics.selectionAsync();
    }, [newAnswerId]);

    const submit = (text: string) => {
        if (!text.trim() || sending) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        send(text);
        setDraft("");
    };

    const canSend = draft.trim().length > 0 && !sending;
    const composerBottom =
        keyboardOverlap > 0
            ? keyboardOverlap + COMPOSER_BOTTOM_GAP
            : Math.max(insets.bottom, 12) + COMPOSER_BOTTOM_GAP;
    const enter = (id: string) =>
        shownAtOpen.has(id) ? undefined : FadeInDown.duration(ENTER_MS);

    return (
        <DetailScreen
            title="AI Assistant"
            presentation="sheet"
            nebulaColors={nebula}
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
                            accessibilityLabel="New chat"
                            onPress={reset}
                        >
                            <Ionicons
                                name="create-outline"
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
                <Animated.ScrollView
                    ref={scrollRef}
                    className="flex-1"
                    contentContainerClassName="grow gap-5 px-5 pt-2"
                    contentContainerStyle={{
                        paddingBottom:
                            composerHeight +
                            composerBottom +
                            COMPOSER_CLEARANCE,
                    }}
                    onScroll={onScroll}
                    scrollEventThrottle={16}
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
                            <Animated.View
                                key={entry.id}
                                entering={enter(entry.id)}
                            >
                                <MessageRow entry={entry} />
                            </Animated.View>
                        ))
                    )}
                    {confirmation ? (
                        <Animated.View entering={FadeInDown.duration(ENTER_MS)}>
                            <ConfirmCard
                                confirmation={confirmation}
                                onAnswer={answerConfirmation}
                            />
                        </Animated.View>
                    ) : sending ? (
                        <Animated.View entering={FadeIn.duration(ENTER_MS)}>
                            <ThinkingIndicator />
                        </Animated.View>
                    ) : null}
                    {error && !sending ? (
                        <Animated.View entering={FadeInDown.duration(ENTER_MS)}>
                            <ErrorRow message={error} onRetry={retry} />
                        </Animated.View>
                    ) : null}
                </Animated.ScrollView>

                <ComposerEdgeBlur
                    height={composerHeight + composerBottom + EDGE_BLUR_FADE}
                    hiddenBelow={hiddenBelow}
                />
                <View
                    style={{
                        position: "absolute",
                        left: COMPOSER_SIDE_GAP,
                        right: COMPOSER_SIDE_GAP,
                        bottom: composerBottom,
                    }}
                    onLayout={(event) =>
                        setComposerHeight(event.nativeEvent.layout.height)
                    }
                >
                    <Composer
                        draft={draft}
                        onChangeDraft={setDraft}
                        onFocus={onFocus}
                        onSubmit={() => submit(draft)}
                        canSend={canSend}
                        sending={sending}
                    />
                </View>
            </View>
        </DetailScreen>
    );
}

const COMPOSER_RADIUS = COMPOSER_MIN_HEIGHT / 2;

/**
 * The field and its button on one capsule of glass. The button sends, in the
 * accent, or while an answer is coming shows Stop.
 */
function Composer({
    draft,
    onChangeDraft,
    onFocus,
    onSubmit,
    canSend,
    sending,
}: {
    draft: string;
    onChangeDraft: (text: string) => void;
    onFocus: () => void;
    onSubmit: () => void;
    canSend: boolean;
    sending: boolean;
}) {
    const { colors } = useAppTheme();
    const outlined = shouldShowGlassOutline();

    return (
        <View
            className={cn(
                "flex-row items-end overflow-hidden",
                outlined && "border border-border",
            )}
            style={{
                minHeight: COMPOSER_MIN_HEIGHT,
                borderRadius: COMPOSER_RADIUS,
            }}
        >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="regular"
                    style={[
                        StyleSheet.absoluteFill,
                        { borderRadius: COMPOSER_RADIUS },
                    ]}
                />
            </View>
            <TextInput
                value={draft}
                onChangeText={onChangeDraft}
                onFocus={onFocus}
                placeholder="Ask about your music"
                placeholderTextColor={colors.mutedForeground}
                multiline
                maxLength={MAX_MESSAGE_LENGTH}
                submitBehavior="blurAndSubmit"
                returnKeyType="send"
                onSubmitEditing={onSubmit}
                className="max-h-32 flex-1 bg-transparent py-3.5 pl-5 pr-2 text-[16px] text-foreground"
                style={{ minHeight: COMPOSER_MIN_HEIGHT }}
                accessibilityLabel="Message the assistant"
            />
            <View className="p-1.5">
                {sending ? (
                    <Pressable
                        // TODO: stopping an answer is not built yet, so Stop
                        // only shows while one is coming
                        onPress={() => {}}
                        accessibilityRole="button"
                        accessibilityLabel="Stop"
                        className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
                        style={{ backgroundColor: colors.foreground }}
                    >
                        <View
                            className="h-3 w-3 rounded-[3px]"
                            style={{ backgroundColor: colors.background }}
                        />
                    </Pressable>
                ) : (
                    <Pressable
                        onPress={onSubmit}
                        disabled={!canSend}
                        accessibilityRole="button"
                        accessibilityLabel="Send"
                        accessibilityState={{ disabled: !canSend }}
                        className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
                        style={{
                            backgroundColor: colors.brand,
                            opacity: canSend ? 1 : 0.4,
                        }}
                    >
                        <Ionicons
                            name="arrow-up"
                            size={21}
                            color={colors.brandForeground}
                        />
                    </Pressable>
                )}
            </View>
        </View>
    );
}

/** How far the list must run under the composer before the blur is full. */
const EDGE_BLUR_REVEAL = 16;

/**
 * A blur behind the composer that fades out above it, the way an iOS bar
 * softens what scrolls under it. Shows only while some of the list is below
 * the bottom edge, so a chat at rest keeps its nebula clear. iOS only: there
 * is no live blur over the list on Android, and a fill of the background
 * would block out the nebula.
 */
function ComposerEdgeBlur({
    height,
    hiddenBelow,
}: {
    height: number;
    hiddenBelow: SharedValue<number>;
}) {
    const { scheme } = useAppTheme();
    const revealStyle = useAnimatedStyle(() => ({
        opacity: interpolate(
            hiddenBelow.get(),
            [0, EDGE_BLUR_REVEAL],
            [0, 1],
            "clamp",
        ),
    }));
    if (Platform.OS !== "ios") return null;

    return (
        <Animated.View
            pointerEvents="none"
            style={[
                { position: "absolute", left: 0, right: 0, bottom: 0, height },
                revealStyle,
            ]}
        >
            <MaskedView
                style={StyleSheet.absoluteFill}
                maskElement={
                    <LinearGradient
                        colors={["transparent", "black", "black"]}
                        locations={[0, EDGE_BLUR_FADE / height, 1]}
                        style={StyleSheet.absoluteFill}
                    />
                }
            >
                <BlurView
                    intensity={30}
                    tint={
                        scheme === "dark"
                            ? "systemThinMaterialDark"
                            : "systemThinMaterialLight"
                    }
                    style={StyleSheet.absoluteFill}
                />
            </MaskedView>
        </Animated.View>
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
