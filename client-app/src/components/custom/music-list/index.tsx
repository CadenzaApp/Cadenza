import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import type { MusicItem } from "@apple-musickit";
import Animated from "react-native-reanimated";

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
export function MusicList({
    tracks,
    isLoading,
    onTrackPressOverride = null,
    trackMenuActions = [],
    multiSelect = null,
    fullBleedRows = false,
    fullBleedRowHorizontalPadding = 24,
    rowSurfaceColor = "background",
    embedded = false,
    showTags = true,
    anticipatedTrackCount = 8,
    listHeader,
    onScroll,
    pagination,
    sorting,
}: MusicListProps) {
    const { togglePlayback } = usePlaybackCommands();
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
    const { listBottomInset, playerBottomInset } = useScreenOverlayInsets();
    const taggableIds = useMemo(
        () =>
            showTags ? tracks.map((track) => track.catalogId ?? track.id) : [],
        [showTags, tracks],
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
    const contentBottomInset = embedded
        ? 0
        : selection.isSelecting
          ? selectionToolbarBottom + selectionToolbarHeight + 12
          : sortingEnabled
            ? listBottomInset
            : Math.max(40, playerBottomInset + 12);
    const listExtraData = useMemo(
        () => ({
            selectedIds: selection.selectedIds,
            tagsBySong,
        }),
        [selection.selectedIds, tagsBySong],
    );

    useEffect(() => {
        isLoadingMoreRef.current = isLoadingNextPage;
    }, [isLoadingNextPage]);

    useEffect(() => {
        isSelectingRef.current = isSelecting;
    }, [isSelecting]);

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
            <Animated.FlatList
                data={displayedTracks}
                extraData={listExtraData}
                initialNumToRender={MUSIC_LIST_RENDER_BATCH_SIZE}
                maxToRenderPerBatch={MUSIC_LIST_RENDER_BATCH_SIZE}
                windowSize={MUSIC_LIST_WINDOW_SIZE}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <MusicListItem
                        item={item}
                        selected={selection.selectedIds.has(item.id)}
                        selectionMode={selection.isSelecting}
                        multiSelectEnabled={selection.enabled}
                        animateSelectionTransition={animateSelectionTransition}
                        fullBleed={fullBleedRows}
                        fullBleedHorizontalPadding={
                            fullBleedRowHorizontalPadding
                        }
                        rowSurfaceColor={rowSurfaceColor}
                        tags={
                            showTags
                                ? tagsBySong[item.catalogId ?? item.id]
                                : undefined
                        }
                        onPress={handleTrackPress}
                        onLongPress={selection.beginSelection}
                        onOpenMenu={setMenuTrack}
                    />
                )}
                contentContainerClassName={fullBleedRows ? undefined : "px-6"}
                contentContainerStyle={{
                    paddingBottom: contentBottomInset,
                }}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={
                    isLoading ? (
                        <View>
                            {Array.from({
                                length: anticipatedTrackCount,
                            }).map((_, index) => (
                                <View key={index}>
                                    <MusicListItemSkeleton
                                        fullBleed={fullBleedRows}
                                        fullBleedHorizontalPadding={
                                            fullBleedRowHorizontalPadding
                                        }
                                    />
                                </View>
                            ))}
                        </View>
                    ) : (
                        <Text className="text-muted-foreground text-center mt-10">
                            No tracks.
                        </Text>
                    )
                }
                ListFooterComponent={
                    isLoadingNextPage ? (
                        <MusicListLoadingSkeletons
                            fullBleed={fullBleedRows}
                            fullBleedHorizontalPadding={
                                fullBleedRowHorizontalPadding
                            }
                        />
                    ) : null
                }
                onScroll={onScroll}
                scrollEventThrottle={onScroll ? 16 : undefined}
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.1}
            />

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
    fullBleedHorizontalPadding,
}: {
    fullBleed: boolean;
    fullBleedHorizontalPadding: number;
}) {
    return (
        <View>
            {Array.from({ length: 5 }).map((_, index) => (
                <View key={index}>
                    <MusicListItemSkeleton
                        fullBleed={fullBleed}
                        fullBleedHorizontalPadding={fullBleedHorizontalPadding}
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
