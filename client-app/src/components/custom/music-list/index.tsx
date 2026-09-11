import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, View } from "react-native";
import type { MusicItem } from "@apple-musickit";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    FadeIn,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { SongDetailModal } from "@/components/custom/song-detail-modal";
import { usePlayback, usePlaybackCommands } from "@/lib/playback";
import { useTagsOnSongs } from "@/lib/routes/songs";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";

import { MusicListItem, MusicListItemSkeleton } from "./music-list-item";
import { MusicListSelectionToolbar } from "./music-list-selection-toolbar";
import { MusicListSortButton } from "./music-list-sort-button";
import { MusicListTrackMenu } from "./music-list-track-menu";
import { sortTracks } from "./sort-tracks";
import { useMusicListSelection } from "./use-music-list-selection";
import {
    DEFAULT_MUSIC_LIST_SORT_OPTIONS,
    type MusicListProps,
    type MusicListSort,
} from "./types";

const DEFAULT_SORT: MusicListSort = {
    option: "title",
    direction: "ascending",
};
const MUSIC_LIST_WINDOW_SIZE = 3;
const MUSIC_LIST_RENDER_BATCH_SIZE = 8;
// for multiselects, if you have a really long music list
// the animation can get laggy.
const MAX_ANIMATED_SELECTION_TRACKS = 100;
const DENSITY_FADE_OUT_MS = 140;
const DENSITY_ROW_FADE_IN_MS = 220;
const DENSITY_ROW_STAGGER_MS = 32;
const DENSITY_MAX_STAGGER_MS = 560;

export function MusicList({
    tracks,
    isLoading,
    onTrackPressOverride = null,
    trackMenuActions = [],
    multiSelect = null,
    fullBleedRows = false,
    compact,
    onCompactChange,
    anticipatedTrackCount = 8,
    pagination,
    sorting,
}: MusicListProps) {
    const { togglePlayback } = usePlaybackCommands();
    const [internalCompact, setInternalCompact] = useState(false);
    const isCompact = compact ?? internalCompact;
    const [densityTransitionRevision, setDensityTransitionRevision] =
        useState(0);
    const [densityTransitioning, setDensityTransitioning] = useState(false);
    const [densityRevealActive, setDensityRevealActive] = useState(false);
    const [internalSort, setInternalSort] = useState(
        sorting?.defaultValue ?? DEFAULT_SORT,
    );
    const [menuTrack, setMenuTrack] = useState<(typeof tracks)[number] | null>(
        null,
    );
    const [detailsTrack, setDetailsTrack] = useState<
        (typeof tracks)[number] | null
    >(null);
    const [selectionToolbarHeight, setSelectionToolbarHeight] = useState(120);
    const controlledSort = sorting?.value;
    const onSortChange = sorting?.onChange;
    const sort = controlledSort ?? internalSort;
    const sortOptions = sorting?.options ?? DEFAULT_MUSIC_LIST_SORT_OPTIONS;
    const sortStrategy = sorting?.strategy ?? "local";
    const sortingEnabled = sorting != null && sortOptions.length > 0;
    const hasNextPage = pagination?.hasNextPage ?? false;
    const isLoadingNextPage = pagination?.isLoadingNextPage ?? false;
    const onLoadNextPage = pagination?.onLoadNextPage;
    const isLoadingMoreRef = useRef(false);
    const listRef = useRef<FlatList<(typeof tracks)[number]>>(null);
    const [revealTrackIds, setRevealTrackIds] = useState<ReadonlySet<string>>(
        new Set(),
    );
    const listOpacity = useSharedValue(1);
    const listTransitionStyle = useAnimatedStyle(() => ({
        opacity: listOpacity.get(),
    }));
    const { listBottomInset, playerBottomInset } = useScreenOverlayInsets();
    const taggableIds = useMemo(
        () => tracks.map((track) => track.catalogId ?? track.id),
        [tracks],
    );
    const { tagsBySong } = useTagsOnSongs(taggableIds);
    const displayedTracks = useMemo(
        () =>
            sortingEnabled && sortStrategy === "local"
                ? sortTracks(tracks, sort)
                : tracks,
        [sortStrategy, sortingEnabled, sort, tracks],
    );
    const selection = useMusicListSelection(displayedTracks, multiSelect);
    const { isSelecting, toggleSelection } = selection;
    const isSelectingRef = useRef(isSelecting);
    const animateSelectionTransition =
        displayedTracks.length <= MAX_ANIMATED_SELECTION_TRACKS;
    const selectionToolbarBottom = playerBottomInset + 12;
    const contentBottomInset = selection.isSelecting
        ? selectionToolbarBottom + selectionToolbarHeight + 12
        : sortingEnabled
          ? listBottomInset
          : Math.max(40, playerBottomInset + 12);
    const listExtraData = useMemo(
        () => ({
            isCompact,
            densityTransitionRevision,
            densityRevealActive,
            selectedIds: selection.selectedIds,
        }),
        [
            densityRevealActive,
            densityTransitionRevision,
            isCompact,
            selection.selectedIds,
        ],
    );

    const commitDensityTransition = useCallback(
        (nextCompact: boolean) => {
            if (compact === undefined) setInternalCompact(nextCompact);
            onCompactChange?.(nextCompact);
            setDensityTransitionRevision((revision) => revision + 1);
            setDensityRevealActive(true);
        },
        [compact, onCompactChange],
    );
    const abortDensityTransition = useCallback(() => {
        listOpacity.set(1);
        setDensityTransitioning(false);
        setRevealTrackIds(new Set());
    }, [listOpacity]);
    const beginDensityTransition = useCallback(
        (nextCompact: boolean) => {
            if (nextCompact === isCompact || densityTransitioning) {
                return;
            }
            setRevealTrackIds(
                new Set(displayedTracks.map((track) => track.id)),
            );
            setDensityTransitioning(true);
            listOpacity.set(
                withTiming(
                    0,
                    {
                        duration: DENSITY_FADE_OUT_MS,
                        easing: Easing.out(Easing.quad),
                    },
                    (finished) => {
                        if (finished) {
                            runOnJS(commitDensityTransition)(nextCompact);
                        } else {
                            // Backgrounding the app cancels the fade. Without
                            // this the revision never bumps, the cleanup effect
                            // never runs, and the list stays dimmed with the
                            // pinch guard latched on.
                            runOnJS(abortDensityTransition)();
                        }
                    },
                ),
            );
        },
        [
            abortDensityTransition,
            commitDensityTransition,
            densityTransitioning,
            displayedTracks,
            isCompact,
            listOpacity,
        ],
    );
    // Rebuilding this every render hands GestureDetector a new gesture ~1.3
    // times a second, which can swap the handler out mid-pinch.
    const pinchGesture = useMemo(
        () =>
            Gesture.Pinch().onEnd((event) => {
                if (event.scale <= 0.92)
                    runOnJS(beginDensityTransition)(true);
                else if (event.scale >= 1.08)
                    runOnJS(beginDensityTransition)(false);
            }),
        [beginDensityTransition],
    );

    useEffect(() => {
        if (densityTransitionRevision === 0) return;
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        listOpacity.set(1);
        const revealWindow = setTimeout(() => {
            setDensityRevealActive(false);
            setDensityTransitioning(false);
            setRevealTrackIds(new Set());
        }, DENSITY_MAX_STAGGER_MS + DENSITY_ROW_FADE_IN_MS);
        return () => clearTimeout(revealWindow);
    }, [densityTransitionRevision, listOpacity]);

    useEffect(() => {
        isLoadingMoreRef.current = isLoadingNextPage;
    }, [isLoadingNextPage]);

    useEffect(() => {
        isSelectingRef.current = isSelecting;
    }, [isSelecting]);

    function densityFadeDelay(index: number) {
        return Math.min(
            (index % 18) * DENSITY_ROW_STAGGER_MS,
            DENSITY_MAX_STAGGER_MS,
        );
    }

    const handleSortChange = useCallback(
        (nextSort: MusicListSort) => {
            if (!controlledSort) setInternalSort(nextSort);
            onSortChange?.(nextSort);
        },
        [controlledSort, onSortChange],
    );

    const handleEndReached = useCallback(async () => {
        if (
            !hasNextPage ||
            isLoadingNextPage ||
            !onLoadNextPage ||
            isLoadingMoreRef.current
        ) {
            return;
        }

        isLoadingMoreRef.current = true;
        try {
            await onLoadNextPage();
        } finally {
            isLoadingMoreRef.current = false;
        }
    }, [hasNextPage, isLoadingNextPage, onLoadNextPage]);

    const handleTrackPress = useCallback(
        (track: (typeof tracks)[number]) => {
            if (isSelectingRef.current) {
                toggleSelection(track);
                return;
            }

            if (onTrackPressOverride) {
                void Promise.resolve(onTrackPressOverride(track)).catch(
                    (error) => {
                        console.error("Music list track press failed:", error);
                    },
                );
                return;
            }

            void togglePlayback(track);
        },
        [onTrackPressOverride, togglePlayback, toggleSelection],
    );

    return (
        <View style={{ flex: 1, position: "relative" }}>
            <GestureDetector gesture={pinchGesture}>
                <Animated.View className="flex-1" style={listTransitionStyle}>
                    {isLoading && tracks.length === 0 ? (
                        <View
                            className={fullBleedRows ? undefined : "px-6"}
                            style={{ paddingBottom: contentBottomInset }}
                        >
                            {Array.from({ length: anticipatedTrackCount }).map(
                                (_, index) => (
                                    <View key={index}>
                                        <MusicListItemSkeleton
                                            fullBleed={fullBleedRows}
                                            compact={isCompact}
                                        />
                                    </View>
                                ),
                            )}
                        </View>
                    ) : (
                        <FlatList
                            ref={listRef}
                            data={displayedTracks}
                            extraData={listExtraData}
                            initialNumToRender={MUSIC_LIST_RENDER_BATCH_SIZE}
                            maxToRenderPerBatch={MUSIC_LIST_RENDER_BATCH_SIZE}
                            windowSize={MUSIC_LIST_WINDOW_SIZE}
                            keyExtractor={(item) => item.id}
                            renderItem={({ item, index }) => (
                                <Animated.View
                                    key={`${item.id}:${densityTransitionRevision}`}
                                    entering={
                                        densityRevealActive &&
                                        revealTrackIds.has(item.id)
                                            ? FadeIn.delay(
                                                  densityFadeDelay(index),
                                              ).duration(DENSITY_ROW_FADE_IN_MS)
                                            : undefined
                                    }
                                >
                                    <MusicListItem
                                        item={item}
                                        selected={selection.selectedIds.has(
                                            item.id,
                                        )}
                                        selectionMode={selection.isSelecting}
                                        multiSelectEnabled={selection.enabled}
                                        animateSelectionTransition={
                                            animateSelectionTransition
                                        }
                                        fullBleed={fullBleedRows}
                                        compact={isCompact}
                                        tags={
                                            tagsBySong[
                                                item.catalogId ?? item.id
                                            ]
                                        }
                                        onPress={handleTrackPress}
                                        onLongPress={selection.beginSelection}
                                        onOpenMenu={setMenuTrack}
                                    />
                                </Animated.View>
                            )}
                            contentContainerClassName={
                                fullBleedRows ? undefined : "px-6"
                            }
                            contentContainerStyle={{
                                paddingBottom: contentBottomInset,
                            }}
                            ListEmptyComponent={
                                !isLoading ? (
                                    <Text className="text-muted-foreground text-center mt-10">
                                        No tracks.
                                    </Text>
                                ) : null
                            }
                            ListFooterComponent={
                                isLoadingNextPage ? (
                                    <MusicListLoadingSkeletons
                                        fullBleed={fullBleedRows}
                                        compact={isCompact}
                                    />
                                ) : null
                            }
                            onEndReached={handleEndReached}
                            onEndReachedThreshold={0.1}
                        />
                    )}
                </Animated.View>
            </GestureDetector>

            {sortingEnabled && !selection.isSelecting && (
                <MusicListSortButton
                    sort={sort}
                    options={sortOptions}
                    onSortChange={handleSortChange}
                />
            )}

            {selection.isSelecting && multiSelect ? (
                <MusicListSelectionToolbar
                    tracks={selection.selectedTracks}
                    config={multiSelect}
                    bottom={selectionToolbarBottom}
                    onClear={selection.clearSelection}
                    onHeightChange={setSelectionToolbarHeight}
                />
            ) : null}

            <MusicListTrackMenu
                track={menuTrack}
                onClose={() => setMenuTrack(null)}
                onShowDetails={setDetailsTrack}
                actions={trackMenuActions}
            />

            <MusicListSongDetails
                track={detailsTrack}
                onClose={() => setDetailsTrack(null)}
            />
        </View>
    );
}

function MusicListSongDetails({
    track,
    onClose,
}: {
    track: MusicItem | null;
    onClose: () => void;
}) {
    const { activeTrackId, isPlaying } = usePlayback();
    const { togglePlayback } = usePlaybackCommands();
    return (
        <SongDetailModal
            open={track != null}
            onClose={onClose}
            song={track}
            onTogglePlayback={togglePlayback}
            isThisTrackPlaying={Boolean(
                track?.id && activeTrackId === track.id && isPlaying,
            )}
        />
    );
}

function MusicListLoadingSkeletons({
    fullBleed,
    compact,
}: {
    fullBleed: boolean;
    compact: boolean;
}) {
    return (
        <View>
            {Array.from({ length: 5 }).map((_, index) => (
                <View key={index}>
                    <MusicListItemSkeleton
                        fullBleed={fullBleed}
                        compact={compact}
                    />
                </View>
            ))}
        </View>
    );
}

export type {
    MusicListAction,
    MusicListActionIcon,
    MusicListMultiSelectConfig,
    MusicListPagination,
    MusicListProps,
    MusicListSelectionAction,
    MusicListSort,
    MusicListSortDirection,
    MusicListSortOption,
    MusicListSorting,
    MusicListTrackAction,
} from "./types";
export {
    DEFAULT_MUSIC_LIST_SORT_OPTIONS,
    MUSIC_LIST_SORT_OPTIONS,
} from "./types";
