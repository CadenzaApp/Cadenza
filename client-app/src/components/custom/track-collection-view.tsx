import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useIsFocused, useTheme } from "expo-router/react-navigation";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { useIsPushedScreen } from "@/lib/screen-overlay";
import { useOpenTransitionSettled } from "@/lib/use-open-transition-settled";

import {
    MusicList,
    type MusicListArrangement,
    type MusicListMultiSelectConfig,
    type MusicListPagination,
    type MusicListSections,
    type MusicListTrackAction,
} from "@/components/custom/music-list";
import { ArtworkMosaic } from "@/components/custom/artwork-mosaic";
import { BlendedCover, COVER_BLEED } from "@/components/custom/blended-cover";
import { ModalPopup } from "@/components/custom/modal-popup";
import { Button } from "@/components/ui/button";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { Text } from "@/components/ui/text";
import { useArtworkNebulaColors } from "@/lib/artwork-color";
import { usePlaybackCommands } from "@/lib/playback";
import { logHandledError } from "@/lib/log";

import {
    collectionArtworkGrid,
    formatTrackCollectionSummary,
} from "./track-collection-utils";
import { useAppTheme } from "@/lib/theme";

const ARTWORK_SIZE = 240;
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
    /** Floats over the hero, like `FloatingBackButton`. */
    backControl?: ReactNode;
    options?: readonly TrackCollectionOption[];
    multiSelect?: MusicListMultiSelectConfig | null;
    trackMenuActions?: readonly MusicListTrackAction[];
    showTags?: boolean;
    mostRelevantTags?: readonly string[];
    /** Activity tags to show on every row; see `MusicListProps`. */
    activityTagIds?: readonly number[];
    artworkUrls?: readonly string[];
    /**
     * A smaller copy of a single cover, shown while the large one loads and
     * what its bleed and the nebula are read from. Usually already cached from
     * the tile that opened this.
     */
    artworkPlaceholderUrl?: string | null;
    subtitle?: string;
    summary?: string;
    header?: ReactNode;
    footer?: ReactNode;
    /**
     * The nebula's color when there is no artwork to read one from, and while
     * the artwork's own colors load.
     */
    backgroundColor?: string | null;
    /** The nebula's colors, in place of the ones read from the artwork. */
    nebulaColors?: readonly string[];
    containerStyle?: StyleProp<ViewStyle>;
    pagination?: MusicListPagination | null;
    /**
     * Load every page, each as soon as the last lands, rather than when the
     * list nears its end. For a screen that shows every song and a count of
     * them. Held until the open has finished, so a page landing never lands
     * mid animation.
     */
    loadAllPages?: boolean;
    /** Sort by and Group by; see `MusicListProps`. Hidden when omitted. */
    arrangement?: MusicListArrangement | null;
    /** A grouped list; see `MusicListProps`. */
    sections?: MusicListSections | null;
    /**
     * Drawn in place of the songs, under the hero, like the wait while a whole
     * playlist loads before it can sort.
     */
    listOverlay?: ReactNode;
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
    options = [],
    multiSelect = null,
    trackMenuActions,
    showTags = true,
    mostRelevantTags,
    activityTagIds,
    artworkUrls: artworkUrlsOverride,
    artworkPlaceholderUrl,
    subtitle,
    summary: summaryOverride,
    header,
    footer,
    backgroundColor = null,
    nebulaColors: nebulaColorsOverride,
    containerStyle,
    pagination = null,
    loadAllPages = false,
    arrangement = null,
    sections = null,
    listOverlay = null,
    onContentSizeChange,
    removeClippedSubviews,
    onPlay,
    onShuffle,
    onTrackPressOverride,
    isPlaying = false,
    backControl,
    respectTopSafeArea = false,
}: Props) {
    const { colors } = useTheme();
    const { destructive } = useAppTheme().colors;
    const insets = useSafeAreaInsets();
    const { playQueue } = usePlaybackCommands();
    const [optionsOpen, setOptionsOpen] = useState(false);
    const isFocused = useIsFocused();
    const settled = useOpenTransitionSettled(useIsPushedScreen());
    const scrollY = useSharedValue(0);
    const hasNextPage = pagination?.hasNextPage ?? false;
    const loadingNextPage = pagination?.isLoadingNextPage ?? false;
    const loadNextPage = pagination?.onLoadNextPage;
    useEffect(() => {
        if (
            !isFocused ||
            !loadAllPages ||
            !settled ||
            !hasNextPage ||
            loadingNextPage
        )
            return;
        void loadNextPage?.();
    }, [
        hasNextPage,
        isFocused,
        loadAllPages,
        loadNextPage,
        loadingNextPage,
        settled,
    ]);
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
    const hasDefaultHero = header == null;
    // One cover bleeds into the nebula; a mosaic or a placeholder stays a tile.
    const singleCover =
        hasDefaultHero && artworkUrls.length === 1 ? artworkUrls[0] : null;
    // Small copies where there is one; averaging only needs a thumbnail.
    const sampledColors = useArtworkNebulaColors(
        singleCover ? [artworkPlaceholderUrl ?? singleCover] : artworkUrls,
        backgroundColor,
    );
    const nebulaColors = nebulaColorsOverride ?? sampledColors;
    const actionsDisabled = tracks.length === 0 || isLoading;
    const onScroll = useAnimatedScrollHandler((event) => {
        scrollY.set(Math.max(0, event.contentOffset.y));
    });
    const artworkStyle = useAnimatedStyle(() =>
        hasDefaultHero
            ? {
                  transformOrigin: "center bottom",
                  transform: [{ scale: artworkScale(scrollY.get()) }],
              }
            : {},
    );

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
            logHandledError(
                `Collection option ${option.id} failed`,
                optionError,
            );
        });
    }

    const titleBlock = (
        <>
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
        </>
    );
    const actions = (
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
    );
    const errorText = error ? (
        <Text className="mt-3 text-center text-destructive">
            Failed to load tracks.
        </Text>
    ) : null;

    const defaultHeader = (
        <View
            className="relative px-4 pb-4"
            style={{
                paddingTop:
                    32 +
                    (respectTopSafeArea ? insets.top : 0) +
                    // room for the bleed above the cover
                    (singleCover ? COVER_BLEED / 2 : 0),
            }}
        >
            <View className="items-center">
                {singleCover ? (
                    <Animated.View style={artworkStyle}>
                        <BlendedCover
                            uri={singleCover}
                            placeholderUri={artworkPlaceholderUrl}
                            size={ARTWORK_SIZE}
                            zoomTarget
                        />
                    </Animated.View>
                ) : (
                    <Animated.View style={[artworkStyle, ARTWORK_SHADOW]}>
                        {/* what the native zoom grows out of the tile into */}
                        <Link.AppleZoomTarget>
                            <View collapsable={false}>
                                <ArtworkMosaic
                                    artworkUrls={artworkUrls}
                                    size={ARTWORK_SIZE}
                                    placeholderColor={colors.text}
                                />
                            </View>
                        </Link.AppleZoomTarget>
                    </Animated.View>
                )}
                {titleBlock}
            </View>
            {actions}
            {errorText}
        </View>
    );
    const listHeader = header ?? defaultHeader;

    return (
        <View className="flex-1 bg-background" style={containerStyle}>
            <NebulaBackdrop colors={nebulaColors} layout="full" />
            <MusicList
                // held back until the open animation ends; the rows
                // are ready by then, so they appear as it lands
                tracks={settled && !listOverlay ? tracks : NO_TRACKS}
                isLoading={(isLoading || !settled) && !listOverlay}
                emptyContent={listOverlay ?? undefined}
                highlightTrackId={highlightTrackId}
                pagination={pagination}
                arrangement={arrangement}
                sections={sections}
                anticipatedTrackCount={anticipatedTrackCount}
                header={listHeader}
                footer={footer}
                onContentSizeChange={onContentSizeChange}
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

            {backControl}

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
                                option.destructive ? destructive : colors.text
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

/** Stable, so the held-back list does not get a new array each render. */
const NO_TRACKS: MusicItem[] = [];
