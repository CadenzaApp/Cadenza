import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, View } from "react-native";
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
import { usePlayback } from "@/lib/playback";
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
const MUSIC_LIST_WINDOW_SIZE = 7;
const MUSIC_LIST_RENDER_BATCH_SIZE = 10;
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
    compact = false,
    anticipatedTrackCount = 8,
    hasNextPage = false,
    isLoadingNextPage = false,
    onLoadNextPage,
    showSort = true,
    sortOptions = DEFAULT_MUSIC_LIST_SORT_OPTIONS,
    sort: controlledSort,
    defaultSort = DEFAULT_SORT,
    onSortChange,
}: MusicListProps) {
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();
    const [compactGestureOverride, setCompactGestureOverride] = useState<
        boolean | null
    >(null);
    const [densityTransitionRevision, setDensityTransitionRevision] =
        useState(0);
    const [densityTransitioning, setDensityTransitioning] = useState(false);
    const [densityRevealActive, setDensityRevealActive] = useState(false);
    const [internalSort, setInternalSort] = useState(defaultSort);
    const [menuTrack, setMenuTrack] = useState<(typeof tracks)[number] | null>(
        null,
    );
    const [detailsTrack, setDetailsTrack] = useState<
        (typeof tracks)[number] | null
    >(null);
    const [selectionToolbarHeight, setSelectionToolbarHeight] = useState(120);
    const sort = controlledSort ?? internalSort;
    const sortingEnabled = showSort && sortOptions.length > 0;
    const isLoadingMoreRef = useRef(false);
    const listRef = useRef<FlatList<(typeof tracks)[number]>>(null);
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
        () => (sortingEnabled ? sortTracks(tracks, sort) : tracks),
        [sortingEnabled, sort, tracks],
    );
    const selection = useMusicListSelection(displayedTracks, multiSelect);
    const selectionToolbarBottom = playerBottomInset + 12;
    const isCompact = compactGestureOverride ?? compact;
    const contentBottomInset = selection.isSelecting
        ? selectionToolbarBottom + selectionToolbarHeight + 12
        : sortingEnabled
          ? listBottomInset
          : Math.max(40, playerBottomInset + 12);
    const listExtraData = useMemo(
        () => ({ isCompact, densityTransitionRevision, densityRevealActive }),
        [densityRevealActive, densityTransitionRevision, isCompact],
    );

    const commitDensityTransition = useCallback((nextCompact: boolean) => {
        setCompactGestureOverride(nextCompact);
        setDensityTransitionRevision((revision) => revision + 1);
        setDensityRevealActive(true);
        setDensityTransitioning(false);
    }, []);
    const beginDensityTransition = useCallback(
        (nextCompact: boolean) => {
            if (nextCompact === isCompact || densityTransitioning) {
                return;
            }
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
                        }
                    },
                ),
            );
        },
        [commitDensityTransition, densityTransitioning, isCompact, listOpacity],
    );
    const pinchGesture = Gesture.Pinch().onEnd((event) => {
        if (event.scale <= 0.92) runOnJS(beginDensityTransition)(true);
        else if (event.scale >= 1.08) runOnJS(beginDensityTransition)(false);
    });

    useEffect(() => {
        if (densityTransitionRevision === 0) return;
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        listOpacity.set(1);
        const revealWindow = setTimeout(
            () => setDensityRevealActive(false),
            DENSITY_MAX_STAGGER_MS + DENSITY_ROW_FADE_IN_MS,
        );
        return () => clearTimeout(revealWindow);
    }, [densityTransitionRevision, listOpacity]);

    useEffect(() => {
        isLoadingMoreRef.current = isLoadingNextPage;
    }, [isLoadingNextPage]);

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
            if (selection.isSelecting) {
                selection.toggleSelection(track);
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
        [onTrackPressOverride, selection, togglePlayback],
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
                                    <Animated.View
                                        key={`${index}:${densityTransitionRevision}`}
                                        entering={
                                            densityRevealActive
                                                ? FadeIn.delay(
                                                      densityFadeDelay(index),
                                                  ).duration(
                                                      DENSITY_ROW_FADE_IN_MS,
                                                  )
                                                : undefined
                                        }
                                    >
                                        <MusicListItemSkeleton
                                            fullBleed={fullBleedRows}
                                            compact={isCompact}
                                        />
                                    </Animated.View>
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
                                        densityRevealActive
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
                                        fullBleed={fullBleedRows}
                                        compact={isCompact}
                                        tags={[
                                            ...(tagsBySong?.[
                                                item.catalogId ?? item.id
                                            ]?.global ?? []),
                                            ...(tagsBySong?.[
                                                item.catalogId ?? item.id
                                            ]?.local ?? []),
                                        ]}
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
                                        transitionRevision={
                                            densityTransitionRevision
                                        }
                                        revealActive={densityRevealActive}
                                        fadeDelay={densityFadeDelay}
                                        startIndex={displayedTracks.length}
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

            <SongDetailModal
                open={detailsTrack != null}
                onClose={() => setDetailsTrack(null)}
                song={detailsTrack}
                onTogglePlayback={togglePlayback}
                isThisTrackPlaying={Boolean(
                    detailsTrack?.id &&
                    activeTrackId === detailsTrack.id &&
                    isPlaying,
                )}
            />
        </View>
    );
}

function MusicListLoadingSkeletons({
    fullBleed,
    compact,
    transitionRevision,
    revealActive,
    fadeDelay,
    startIndex,
}: {
    fullBleed: boolean;
    compact: boolean;
    transitionRevision: number;
    revealActive: boolean;
    fadeDelay: (index: number) => number;
    startIndex: number;
}) {
    return (
        <View>
            {Array.from({ length: 5 }).map((_, index) => (
                <Animated.View
                    key={`${index}:${transitionRevision}`}
                    entering={
                        revealActive
                            ? FadeIn.delay(
                                  fadeDelay(startIndex + index),
                              ).duration(DENSITY_ROW_FADE_IN_MS)
                            : undefined
                    }
                >
                    <MusicListItemSkeleton
                        fullBleed={fullBleed}
                        compact={compact}
                    />
                </Animated.View>
            ))}
        </View>
    );
}

export type {
    MusicListAction,
    MusicListActionIcon,
    MusicListMultiSelectConfig,
    MusicListProps,
    MusicListSelectionAction,
    MusicListSort,
    MusicListSortDirection,
    MusicListSortOption,
    MusicListTrackAction,
} from "./types";
export {
    DEFAULT_MUSIC_LIST_SORT_OPTIONS,
    MUSIC_LIST_SORT_OPTIONS,
} from "./types";
