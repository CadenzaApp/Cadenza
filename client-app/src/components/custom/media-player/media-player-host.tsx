import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import Animated, {
    useAnimatedStyle,
    useDerivedValue,
    useAnimatedReaction,
    runOnJS,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    BOTTOM_CONTROL_SPRING,
    selectionOverlayOffsets,
    selectionOffsetAboveNativePlayer,
    auxiliaryControlY,
    PLAYER_SIDE_INSET,
    PLAYER_CONTROL_SIZE,
    PLAYER_ROW_GAP,
    SEARCH_DOCK_X,
} from "@/lib/screen-overlay-geometry";

import { usePlaybackTrackState } from "@/lib/playback";
import { usePlayerPresentation } from "@/lib/player-presentation";

import { useBottomSelectionOverlay } from "@/lib/bottom-selection-overlay";

import {
    GLASS_TAB_BAR,
    useBottomBarsHidden,
    usePlayerHostActive,
    useBottomRowAction,
} from "@/lib/screen-overlay";
import { AssistantRowButton } from "@/features/assistant/assistant-button";

import { MediaPlayer } from "./media-player";

/** Where the row action docks while the player is a circle. */
const CIRCLE_DOCK_X = GLASS_TAB_BAR ? SEARCH_DOCK_X : 0;

const FALLBACK_TAB_BAR_HEIGHT = Platform.select({
    ios: 49,
    android: 80,
    default: 60,
});
// Move the complete control beyond the window's right edge.
const SORT_OFFSCREEN_X = PLAYER_SIDE_INSET + PLAYER_CONTROL_SIZE + 32;
const SORT_SPRING = BOTTOM_CONTROL_SPRING;

type PlayerArtworkStateProps = {
    failedArtworkUrl: string | null;
    onArtworkError: (url: string | null) => void;
};

/** The morphing player above the primary native tab bar on every platform. */
export function MediaPlayerFallbackOverlay({
    hidden,
    nativeAccessoryActive = false,
    failedArtworkUrl,
    onArtworkError,
}: PlayerArtworkStateProps & {
    hidden: boolean;
    nativeAccessoryActive?: boolean;
}) {
    const insets = useSafeAreaInsets();
    const focused = usePlayerHostActive();
    if (!focused) return null;
    const suppressed = hidden;

    return (
        <View
            pointerEvents={suppressed ? "none" : "box-none"}
            style={[StyleSheet.absoluteFill, { opacity: suppressed ? 0 : 1 }]}
        >
            <View
                pointerEvents="box-none"
                style={{
                    position: "absolute",
                    top: 0,
                    left: PLAYER_SIDE_INSET,
                    right: PLAYER_SIDE_INSET,
                    bottom:
                        insets.bottom +
                        FALLBACK_TAB_BAR_HEIGHT +
                        PLAYER_ROW_GAP,
                }}
            >
                <MediaPlayerRow
                    nativePlayer={nativeAccessoryActive}
                    kind="tabs"
                    failedArtworkUrl={failedArtworkUrl}
                    onArtworkError={onArtworkError}
                />
            </View>
        </View>
    );
}

/** Both controls share one parent and one bottom anchor on every host. */
function MediaPlayerRow({
    nativePlayer = false,
    kind = "detail",
    ...props
}: PlayerArtworkStateProps & {
    nativePlayer?: boolean;
    kind?: "tabs" | "detail";
}) {
    const { activeTrack } = usePlaybackTrackState();
    const hasPlayer = activeTrack != null;
    const barsHidden = useBottomBarsHidden();
    const nativeLayout = usePlayerPresentation();
    const { expandedHeight, nativeFrame, motion } = nativeLayout;
    const { progress: circleStack } = motion;
    const rowRef = useRef<View>(null);
    const rowBottom = useSharedValue<number | null>(null);
    const measureRow = useCallback(() => {
        rowRef.current?.measureInWindow((_x, y, width, height) => {
            if (width > 0 && height > 0) rowBottom.set(y + height);
        });
    }, [rowBottom]);
    // Transfer ownership in the same commit that inserts the native glass.
    // Waiting for its layout report briefly paints both materials together.
    const accessoryVisible = nativePlayer;
    const sortScale = useSharedValue(1);
    const sortDockX = useSharedValue(0);
    const nativePanelY = useSharedValue(-(expandedHeight + PLAYER_ROW_GAP));
    const sortAction = useBottomRowAction();
    const [lastAction, setLastAction] = useState(sortAction);
    if (sortAction && sortAction !== lastAction) setLastAction(sortAction);
    const displayedAction = sortAction ?? lastAction;
    const sortVisible = sortAction !== null;
    const nativeTargetY = useSharedValue(-(expandedHeight + PLAYER_ROW_GAP));
    const selectionContent = useBottomSelectionOverlay();
    const selectionVisible = selectionContent != null;
    // Always the row's rightmost control, except while the multiselect
    // toolbar takes the row.
    const assistantVisible = !barsHidden && !selectionVisible;
    const { width: windowWidth } = useWindowDimensions();
    const [selectionPanel, setSelectionPanel] = useState({
        source: selectionContent,
        content: selectionContent,
    });
    // Retain the outgoing panel until its explicit horizontal animation ends.
    if (selectionPanel.source !== selectionContent) {
        setSelectionPanel({
            source: selectionContent,
            content: selectionContent ?? selectionPanel.content,
        });
    }
    const [selectionHeight, setSelectionHeight] = useState(0);
    const selectionReveal = useSharedValue(0);
    const finishSelectionExit = useCallback(() => {
        setSelectionPanel((current) =>
            current.source == null ? { source: null, content: null } : current,
        );
    }, []);
    const revealSelection = selectionVisible && selectionHeight > 0;
    useEffect(() => {
        selectionReveal.set(
            withSpring(revealSelection ? 1 : 0, SORT_SPRING, (finished) => {
                if (finished && !revealSelection)
                    runOnJS(finishSelectionExit)();
            }),
        );
    }, [revealSelection, selectionReveal, finishSelectionExit]);
    useAnimatedReaction(
        () => ({
            frame: nativeFrame.get(),
            bottom: rowBottom.get(),
        }),
        ({ frame, bottom }) => {
            if (!nativePlayer || barsHidden || !frame) return;
            if (bottom == null) return;
            const destination = selectionOffsetAboveNativePlayer(
                bottom,
                frame.y,
                PLAYER_ROW_GAP,
            );
            if (Math.abs(destination - nativeTargetY.get()) > 0.5) {
                nativeTargetY.set(destination);
                nativePanelY.set(withSpring(destination, SORT_SPRING));
            }
            // The inline accessory shares the tucked bar's height with Search.
            // Start shrinking as soon as UIKit's full-width frame contracts.
            const tucking =
                frame.width < windowWidth - PLAYER_SIDE_INSET * 2 - 2;
            const diameter = tucking
                ? Math.max(32, Math.min(PLAYER_CONTROL_SIZE, frame.height))
                : PLAYER_CONTROL_SIZE;
            sortScale.set(
                withSpring(diameter / PLAYER_CONTROL_SIZE, SORT_SPRING),
            );
            // Search keeps its size and place whether the player is expanded
            // or tucked, and the scale is about the button's center, so one
            // shift centers it over Search in both
            sortDockX.set(withSpring(SEARCH_DOCK_X, SORT_SPRING));
        },
    );
    useEffect(() => {
        if (!nativePlayer) {
            const restingY = -(expandedHeight + PLAYER_ROW_GAP);
            nativeTargetY.set(restingY);
            nativePanelY.set(withSpring(restingY, SORT_SPRING));
            sortScale.set(withSpring(1, SORT_SPRING));
            sortDockX.set(
                withSpring(GLASS_TAB_BAR ? SEARCH_DOCK_X : 0, SORT_SPRING),
            );
        }
    }, [
        nativePlayer,
        nativePanelY,
        nativeTargetY,
        expandedHeight,
        sortScale,
        sortDockX,
    ]);
    const bubbleLift = useDerivedValue(
        () =>
            selectionOverlayOffsets(
                selectionReveal.get(),
                selectionHeight,
                windowWidth,
                PLAYER_ROW_GAP,
                circleStack.get(),
                hasPlayer,
            ).playerTranslateY,
    );
    const selectionStyle = useAnimatedStyle(() => {
        const offsets = selectionOverlayOffsets(
            selectionReveal.get(),
            selectionHeight,
            windowWidth,
            PLAYER_ROW_GAP,
            circleStack.get(),
            hasPlayer,
        );
        return {
            transform: [
                { translateX: offsets.panelTranslateX },
                {
                    translateY: auxiliaryControlY(
                        nativePanelY.get(),
                        circleStack.get(),
                        hasPlayer,
                    ),
                },
            ],
        };
    });
    const { colors } = useTheme();
    // Mount offscreen before the first layout or focus registration arrives.
    const sortX = useSharedValue(SORT_OFFSCREEN_X);
    useEffect(() => {
        sortX.set(withSpring(sortVisible ? 0 : SORT_OFFSCREEN_X, SORT_SPRING));
    }, [sortVisible, sortX]);
    // The assistant takes the row's right end and the sort control moves one
    // slot left of it. Only while both show, so a leaving sort control never
    // slides back into view.
    const assistantX = useSharedValue(SORT_OFFSCREEN_X);
    const sortShift = useSharedValue(0);
    useEffect(() => {
        assistantX.set(
            withSpring(assistantVisible ? 0 : SORT_OFFSCREEN_X, SORT_SPRING),
        );
        sortShift.set(
            withSpring(assistantVisible && sortVisible ? 1 : 0, SORT_SPRING),
        );
    }, [assistantVisible, sortVisible, assistantX, sortShift]);
    const assistantStyle = useAnimatedStyle(() => ({
        transform: [
            {
                // the same dock as the row action, so it stays over Search
                // in circle mode too
                translateX:
                    assistantX.get() +
                    sortDockX.get() * (1 - circleStack.get()) +
                    CIRCLE_DOCK_X * circleStack.get(),
            },
            {
                translateY:
                    auxiliaryControlY(
                        nativePanelY.get(),
                        circleStack.get(),
                        hasPlayer,
                    ) +
                    (PLAYER_CONTROL_SIZE * (1 - sortScale.get())) / 2,
            },
            { scale: sortScale.get() },
        ],
    }));
    const sortStyle = useAnimatedStyle(() => ({
        transform: [
            {
                // collapsing to the circle drops the native player's dock,
                // but Search stays where it is, so the button stays over it
                translateX:
                    sortX.get() +
                    sortDockX.get() * (1 - circleStack.get()) +
                    CIRCLE_DOCK_X * circleStack.get() -
                    sortShift.get() *
                        (PLAYER_CONTROL_SIZE * sortScale.get() +
                            PLAYER_ROW_GAP),
            },
            {
                translateY:
                    auxiliaryControlY(
                        nativePanelY.get(),
                        circleStack.get(),
                        hasPlayer,
                    ) +
                    (PLAYER_CONTROL_SIZE * (1 - sortScale.get())) / 2,
            },
            { scale: sortScale.get() },
        ],
    }));
    return (
        <View
            ref={rowRef}
            onLayout={measureRow}
            collapsable={false}
            pointerEvents="box-none"
            className="flex-1"
        >
            <View
                pointerEvents="box-none"
                accessibilityElementsHidden={accessoryVisible}
                importantForAccessibility={
                    accessoryVisible ? "no-hide-descendants" : "auto"
                }
                style={[
                    {
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                        zIndex: 2,
                    },
                ]}
            >
                <MediaPlayer
                    {...props}
                    nativePlayer={nativePlayer}
                    visible={!barsHidden}
                    kind={kind}
                    bubbleLift={bubbleLift}
                />
            </View>
            {selectionPanel.content != null ? (
                <Animated.View
                    pointerEvents={selectionVisible ? "auto" : "none"}
                    accessibilityElementsHidden={!selectionVisible}
                    style={[
                        {
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            zIndex: 1,
                            borderRadius: 12,
                        },
                        selectionStyle,
                    ]}
                    onLayout={(event) =>
                        setSelectionHeight(event.nativeEvent.layout.height)
                    }
                >
                    {selectionPanel.content}
                </Animated.View>
            ) : null}
            <Animated.View
                className="absolute bottom-0 right-0"
                style={sortStyle}
                pointerEvents={sortVisible ? "auto" : "none"}
                accessibilityElementsHidden={!sortVisible}
                importantForAccessibility={
                    sortVisible ? "auto" : "no-hide-descendants"
                }
            >
                <GlassIconButton
                    size={PLAYER_CONTROL_SIZE}
                    bordered={false}
                    style={{
                        borderRadius: PLAYER_CONTROL_SIZE / 2,
                    }}
                    disabled={!sortVisible}
                    onPress={sortAction?.onPress}
                    accessibilityLabel={displayedAction?.accessibilityLabel}
                    accessibilityState={{
                        expanded: sortAction?.expanded ?? false,
                    }}
                >
                    <Ionicons
                        name={displayedAction?.icon ?? "funnel-outline"}
                        size={28}
                        color={colors.text}
                    />
                </GlassIconButton>
            </Animated.View>
            <Animated.View
                className="absolute bottom-0 right-0"
                style={assistantStyle}
                pointerEvents={assistantVisible ? "auto" : "none"}
                accessibilityElementsHidden={!assistantVisible}
                importantForAccessibility={
                    assistantVisible ? "auto" : "no-hide-descendants"
                }
            >
                <AssistantRowButton disabled={!assistantVisible} />
            </Animated.View>
        </View>
    );
}
