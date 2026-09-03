import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useTagsOnSongs } from "@/lib/routes/songs";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";

import { MusicListItem, MusicListItemSkeleton } from "./music-list-item";
import { MusicListSortButton } from "./music-list-sort-button";
import { sortTracks } from "./sort-tracks";
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
    activeTrackId,
    isPlaying,
    onTogglePlayback,
    onSelectTrack,
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
    const [internalSort, setInternalSort] = useState(defaultSort);
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
    const contentBottomInset = sortingEnabled
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

    return (
        <View style={{ flex: 1, position: "relative" }}>
            {isLoading && tracks.length === 0 ? (
                <View
                    className="px-6"
                    style={{ paddingBottom: contentBottomInset }}
                >
                    {Array.from({ length: anticipatedTrackCount }).map(
                        (_, index) => (
                            <MusicListItemSkeleton key={index} />
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
                            isThisTrackPlaying={
                                activeTrackId === item.id && isPlaying
                            }
                            onTogglePlayback={onTogglePlayback}
                            tags={[
                                ...(tagsBySong?.[item.catalogId ?? item.id]
                                    ?.global ?? []),
                                ...(tagsBySong?.[item.catalogId ?? item.id]
                                    ?.local ?? []),
                            ]}
                            onPress={onSelectTrack}
                        />
                    )}
                    contentContainerClassName="px-6"
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
                        isLoadingNextPage ? <MusicListLoadingSkeletons /> : null
                    }
                    onEndReached={handleEndReached}
                    onEndReachedThreshold={0.1}
                />
            )}

            {sortingEnabled && (
                <MusicListSortButton
                    sort={sort}
                    options={sortOptions}
                    onSortChange={handleSortChange}
                />
            )}
        </View>
    );
}

function MusicListLoadingSkeletons() {
    return (
        <View>
            {Array.from({ length: 3 }).map((_, index) => (
                <MusicListItemSkeleton key={index} />
            ))}
        </View>
    );
}

export type {
    MusicListProps,
    MusicListSort,
    MusicListSortDirection,
    MusicListSortOption,
} from "./types";
export {
    DEFAULT_MUSIC_LIST_SORT_OPTIONS,
    MUSIC_LIST_SORT_OPTIONS,
} from "./types";
