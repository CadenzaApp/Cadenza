import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
    Image,
    View,
    type ColorValue,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedReaction,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsPushedDetailScreen } from "@/lib/screen-overlay";
import { useOpenTransitionSettled } from "@/lib/use-open-transition-settled";
import { useZoomFocus } from "@/lib/zoom-dismiss";

import {
    MusicList,
    type MusicListMultiSelectConfig,
    type MusicListPagination,
    type MusicListSorting,
    type MusicListTrackAction,
} from "@/components/custom/music-list";
import { ModalPopup } from "@/components/custom/modal-popup";
import { Button } from "@/components/ui/button";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import {
    TintBackdrop,
    TintOverscrollBackdrop,
} from "@/components/ui/tint-backdrop";
import { usePlaybackCommands } from "@/lib/playback";
import { useTintGradient } from "@/lib/use-tint-gradient";

import {
    collectionArtworkGrid,
    formatTrackCollectionSummary,
} from "./track-collection-utils";

const ARTWORK_SIZE = 224;
const ARTWORK_SCROLL_SCALE_DISTANCE = 120;

/** How far the hero artwork has shrunk, scrolled this far down. */
function artworkScale(scrollY: number) {
    "worklet";
    return interpolate(
        scrollY,
        [0, ARTWORK_SCROLL_SCALE_DISTANCE],
        [1, 0.8],
        Extrapolation.CLAMP,
    );
}

/**
 * The hero artwork as measured once at full size: its unshrunk size, the
 * point it shrinks toward, and the scroll it was measured at.
 */
type ArtworkBase = {
    centerX: number;
    bottom: number;
    width: number;
    height: number;
    scrollY: number;
};
const ARTWORK_SHADOW: ViewStyle = {
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
};
const TITLE_CONTENT_SHADOW: ViewStyle = {
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
};

export type TrackCollectionOption = {
    id: string;
    label: string;
    icon: ComponentProps<typeof Ionicons>["name"];
    destructive?: boolean;
    onPress: () => void | Promise<void>;
};

export type { MusicListMultiSelectConfig } from "@/components/custom/music-list";

type Props = {
    title: string;
    /** A filled icon rendered immediately before the standard collection title. */
    titleIcon?: ComponentProps<typeof Ionicons>["name"];
    /** Replaces the standard title row while preserving its place in the hero. */
    titleContent?: ReactNode;
    tracks: MusicItem[];
    isLoading: boolean;
    /** A song to point out; see `MusicListProps`. */
    highlightTrackId?: string;
    error?: unknown;
    anticipatedTrackCount?: number;
    onBackPress?: () => void;
    closeControl?: ReactNode;
    options?: readonly TrackCollectionOption[];
    multiSelect?: MusicListMultiSelectConfig | null;
    trackMenuActions?: readonly MusicListTrackAction[];
    showTags?: boolean;
    mostRelevantTags?: readonly string[];
    /** Activity tags to show on every row; see `MusicListProps`. */
    activityTagIds?: readonly number[];
    artworkUrls?: readonly string[];
    subtitle?: string;
    summary?: string;
    header?: ReactNode;
    footer?: ReactNode;
    /** Source color for the mode-aware Oklch background gradient. */
    backgroundColor?: string | null;
    containerStyle?: StyleProp<ViewStyle>;
    pagination?: MusicListPagination | null;
    sorting?: MusicListSorting | null;
    onContentSizeChange?: (width: number, height: number) => void;
    removeClippedSubviews?: boolean;
    onPlay?: () => void | Promise<void>;
    onShuffle?: () => void | Promise<void>;
    /** Passed straight to the track list, for a host that needs to know a row was played. */
    onTrackPressOverride?: ((track: MusicItem) => void | Promise<void>) | null;
    isPlaying?: boolean;
    respectTopSafeArea?: boolean;
};

/** Reusable artwork, actions, metadata, and track-list surface for a collection. */
export function TrackCollectionView({
    title,
    titleIcon,
    titleContent,
    tracks,
    isLoading,
    highlightTrackId,
    error,
    anticipatedTrackCount,
    onBackPress,
    options = [],
    multiSelect = null,
    trackMenuActions,
    showTags = true,
    mostRelevantTags,
    activityTagIds,
    artworkUrls: artworkUrlsOverride,
    subtitle,
    summary: summaryOverride,
    header,
    footer,
    backgroundColor = null,
    containerStyle,
    pagination = null,
    sorting = {
        strategy: "local",
        defaultValue: { option: "title", direction: "ascending" },
    },
    onContentSizeChange,
    removeClippedSubviews,
    onPlay,
    onShuffle,
    onTrackPressOverride,
    isPlaying = false,
    closeControl,
    respectTopSafeArea = false,
}: Props) {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { playQueue } = usePlaybackCommands();
    const [optionsOpen, setOptionsOpen] = useState(false);
    const settled = useOpenTransitionSettled(useIsPushedDetailScreen());
    const scrollY = useSharedValue(0);
    const derivedArtworkUrls = useMemo(
        () =>
            artworkUrlsOverride || header ? [] : collectionArtworkGrid(tracks),
        [artworkUrlsOverride, header, tracks],
    );
    const artworkUrls = artworkUrlsOverride ?? derivedArtworkUrls;
    const summary = useMemo(
        () => summaryOverride ?? formatTrackCollectionSummary(tracks),
        [summaryOverride, tracks],
    );
    const gradient = useTintGradient(backgroundColor);
    const actionsDisabled = tracks.length === 0 || isLoading;
    const onScroll = useAnimatedScrollHandler((event) => {
        scrollY.set(Math.max(0, event.contentOffset.y));
    });
    // where the hero artwork is, for the close to land it on its tile
    const artworkRef = useAnimatedRef<Animated.View>();
    const zoomFocus = useZoomFocus();
    const artworkBase = useSharedValue<ArtworkBase | null>(null);
    useEffect(() => {
        // measured once the card is full size, when screen and page agree
        if (!settled || header) return;
        artworkRef.current?.measureInWindow((x, y, width, height) => {
            if (width <= 0 || height <= 0) return;
            const scale = artworkScale(scrollY.get());
            artworkBase.set({
                centerX: x + width / 2,
                bottom: y + height,
                width: width / scale,
                height: height / scale,
                scrollY: scrollY.get(),
            });
        });
    }, [artworkBase, artworkRef, header, scrollY, settled]);
    useAnimatedReaction(
        () => {
            const base = artworkBase.get();
            if (!base) return null;
            const scrolled = scrollY.get();
            const scale = artworkScale(scrolled);
            const width = base.width * scale;
            const height = base.height * scale;
            const bottom = base.bottom - (scrolled - base.scrollY);
            return {
                x: base.centerX - width / 2,
                y: bottom - height,
                width,
                height,
            };
        },
        (rect) => {
            zoomFocus?.set(rect);
        },
    );

    const artworkStyle = useAnimatedStyle(() => ({
        transformOrigin: "center bottom",
        transform: [
            {
                scale: artworkScale(scrollY.get()),
            },
        ],
    }));

    function playAll() {
        const command = onPlay ? onPlay() : playQueue({ tracks });
        void Promise.resolve(command).catch(() => {
            // The playback provider owns the user-facing error.
        });
    }

    function shuffleAll() {
        if (onShuffle) {
            void Promise.resolve(onShuffle()).catch(() => {
                // The caller owns the user-facing error.
            });
            return;
        }
        const shuffled = [...tracks];
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[swapIndex]] = [
                shuffled[swapIndex],
                shuffled[index],
            ];
        }
        void playQueue({ tracks: shuffled }).catch(() => {
            // The playback provider owns the user-facing error.
        });
    }

    function runOption(option: TrackCollectionOption) {
        setOptionsOpen(false);
        void Promise.resolve(option.onPress()).catch((optionError) => {
            console.error(
                `Collection option ${option.id} failed:`,
                optionError,
            );
        });
    }

    const defaultHeader = (
        <View
            className="relative px-4 pb-4"
            style={{ paddingTop: 32 + (respectTopSafeArea ? insets.top : 0) }}
        >
            <View className="items-center">
                <Animated.View
                    ref={artworkRef}
                    style={[artworkStyle, ARTWORK_SHADOW]}
                >
                    <ArtworkMosaic
                        artworkUrls={artworkUrls}
                        placeholderColor={colors.text}
                    />
                </Animated.View>
                {titleContent ? (
                    <View className="mt-4" style={TITLE_CONTENT_SHADOW}>
                        {titleContent}
                    </View>
                ) : (
                    <View className="mt-4 flex-row items-center justify-center gap-2">
                        {titleIcon ? (
                            <Ionicons
                                name={titleIcon}
                                size={24}
                                color={colors.text}
                                accessibilityElementsHidden
                                importantForAccessibility="no"
                            />
                        ) : null}
                        <Text className="text-center text-2xl font-bold">
                            {title}
                        </Text>
                    </View>
                )}
                {subtitle ? (
                    <Text className="mt-1 text-center text-base text-muted-foreground">
                        {subtitle}
                    </Text>
                ) : null}
                <Text className="mt-1 text-sm text-muted-foreground">
                    {summary}
                </Text>
            </View>

            <View className="mt-4 flex-row items-center gap-2.5">
                <Button
                    className="h-12 flex-1 rounded-xl"
                    disabled={actionsDisabled}
                    onPress={playAll}
                    accessibilityLabel={`Play ${title}`}
                >
                    <Ionicons
                        name={isPlaying ? "pause" : "play"}
                        size={25}
                        color={colors.background}
                    />
                    <Text className="font-semibold">
                        {isPlaying ? "Pause" : "Play"}
                    </Text>
                </Button>
                <Button
                    variant="secondary"
                    className="h-12 flex-1 rounded-xl"
                    disabled={actionsDisabled}
                    onPress={shuffleAll}
                    accessibilityLabel={`Shuffle ${title}`}
                >
                    <Ionicons name="shuffle" size={25} color={colors.text} />
                    <Text className="font-semibold">Shuffle</Text>
                </Button>
                {options.length === 1 ? (
                    <GlassIconButton
                        size={48}
                        onPress={() => runOption(options[0])}
                        accessibilityLabel={options[0].label}
                    >
                        <Ionicons
                            name={options[0].icon}
                            size={25}
                            color={colors.text}
                        />
                    </GlassIconButton>
                ) : options.length > 1 ? (
                    <GlassIconButton
                        size={48}
                        onPress={() => setOptionsOpen(true)}
                        accessibilityLabel={`More options for ${title}`}
                        accessibilityState={{ expanded: optionsOpen }}
                    >
                        <Ionicons
                            name="ellipsis-vertical"
                            size={25}
                            color={colors.text}
                        />
                    </GlassIconButton>
                ) : null}
            </View>

            {error ? (
                <Text className="mt-3 text-center text-destructive">
                    Failed to load tracks.
                </Text>
            ) : null}
        </View>
    );
    const listHeader = header ?? defaultHeader;

    return (
        <View className="flex-1 bg-background" style={containerStyle}>
            <TintOverscrollBackdrop gradient={gradient} />
            <MusicList
                // held back until the open animation ends; the rows
                // are ready by then, so they appear as it lands
                tracks={settled ? tracks : NO_TRACKS}
                isLoading={isLoading || !settled}
                highlightTrackId={highlightTrackId}
                pagination={pagination}
                sorting={sorting}
                anticipatedTrackCount={anticipatedTrackCount}
                header={listHeader}
                footer={footer}
                onContentSizeChange={onContentSizeChange}
                // inside the scroll content, so it always spans exactly the
                // rows. sized from a measured content height it ended early
                // whenever the list's estimate came in short
                contentBackground={
                    gradient ? <TintBackdrop gradient={gradient} /> : null
                }
                removeClippedSubviews={removeClippedSubviews}
                onScroll={onScroll}
                multiSelect={multiSelect}
                trackMenuActions={trackMenuActions}
                showTags={showTags}
                mostRelevantTags={mostRelevantTags}
                activityTagIds={activityTagIds}
                onTrackPressOverride={onTrackPressOverride}
                fullBleedRows
            />

            {closeControl ??
                (onBackPress ? (
                    <View className="absolute left-4 top-3 z-20">
                        <GlassIconButton
                            size={48}
                            onPress={onBackPress}
                            accessibilityLabel="Back"
                            style={{
                                shadowColor: "#000",
                                shadowOpacity: 0.18,
                                shadowRadius: 9,
                                shadowOffset: { width: 0, height: 3 },
                                elevation: 8,
                            }}
                        >
                            <Ionicons
                                name="chevron-back"
                                size={28}
                                color={colors.text}
                            />
                        </GlassIconButton>
                    </View>
                ) : null)}

            <ModalPopup
                visible={optionsOpen}
                onClose={() => setOptionsOpen(false)}
                title="Options"
            >
                {options.map((option) => (
                    <Button
                        key={option.id}
                        variant="ghost"
                        className="w-full justify-start rounded-lg"
                        onPress={() => runOption(option)}
                    >
                        <Ionicons
                            name={option.icon}
                            size={19}
                            color={
                                option.destructive
                                    ? colors.notification
                                    : colors.text
                            }
                        />
                        <Text
                            className={
                                option.destructive
                                    ? "text-destructive"
                                    : undefined
                            }
                        >
                            {option.label}
                        </Text>
                    </Button>
                ))}
            </ModalPopup>
        </View>
    );
}

function ArtworkMosaic({
    artworkUrls,
    placeholderColor,
}: {
    artworkUrls: readonly string[];
    placeholderColor: ColorValue;
}) {
    const oneArtwork = artworkUrls.length === 1 ? artworkUrls[0] : null;

    if (oneArtwork) {
        return (
            <Image
                source={{ uri: oneArtwork }}
                className="rounded-2xl bg-muted"
                style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }}
            />
        );
    }

    return (
        <View
            className="flex-row flex-wrap overflow-hidden rounded-2xl bg-muted"
            style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }}
        >
            {Array.from({ length: 4 }, (_, index) => {
                const url = artworkUrls[index];
                return url ? (
                    <Image
                        key={`${url}:${index}`}
                        source={{ uri: url }}
                        className="bg-muted"
                        style={{
                            width: ARTWORK_SIZE / 2,
                            height: ARTWORK_SIZE / 2,
                        }}
                    />
                ) : (
                    <View
                        key={index}
                        className="items-center justify-center bg-muted"
                        style={{
                            width: ARTWORK_SIZE / 2,
                            height: ARTWORK_SIZE / 2,
                        }}
                    >
                        <Ionicons
                            name="musical-notes"
                            size={30}
                            color={placeholderColor}
                            style={{ opacity: 0.45 }}
                        />
                    </View>
                );
            })}
        </View>
    );
}

/** Stable, so the held-back list does not get a new array each render. */
const NO_TRACKS: MusicItem[] = [];
