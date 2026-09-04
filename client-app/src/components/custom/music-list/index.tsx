import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, View } from "react-native";

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

export function MusicList({
    tracks,
    isLoading,
    onTrackPressOverride = null,
    trackMenuActions = [],
    multiSelect = null,
    fullBleedRows = false,
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
    const contentBottomInset = selection.isSelecting
        ? selectionToolbarBottom + selectionToolbarHeight + 12
        : sortingEnabled
          ? listBottomInset
          : Math.max(40, playerBottomInset + 12);

    useEffect(() => {
        isLoadingMoreRef.current = isLoadingNextPage;
    }, [isLoadingNextPage]);

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
            {isLoading && tracks.length === 0 ? (
                <View
                    className={fullBleedRows ? undefined : "px-6"}
                    style={{ paddingBottom: contentBottomInset }}
                >
                    {Array.from({ length: anticipatedTrackCount }).map(
                        (_, index) => (
                            <MusicListItemSkeleton
                                key={index}
                                fullBleed={fullBleedRows}
                            />
                        ),
                    )}
                </View>
            ) : (
                <FlatList
                    data={displayedTracks}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <MusicListItem
                            item={item}
                            selected={selection.selectedIds.has(item.id)}
                            selectionMode={selection.isSelecting}
                            multiSelectEnabled={selection.enabled}
                            fullBleed={fullBleedRows}
                            tags={[
                                ...(tagsBySong?.[item.catalogId ?? item.id]
                                    ?.global ?? []),
                                ...(tagsBySong?.[item.catalogId ?? item.id]
                                    ?.local ?? []),
                            ]}
                            onPress={handleTrackPress}
                            onLongPress={selection.beginSelection}
                            onOpenMenu={setMenuTrack}
                        />
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
                            />
                        ) : null
                    }
                    onEndReached={handleEndReached}
                    onEndReachedThreshold={0.1}
                />
            )}

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

function MusicListLoadingSkeletons({ fullBleed }: { fullBleed: boolean }) {
    return (
        <View>
            {Array.from({ length: 3 }).map((_, index) => (
                <MusicListItemSkeleton key={index} fullBleed={fullBleed} />
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
