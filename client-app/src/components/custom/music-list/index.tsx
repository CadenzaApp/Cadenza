import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, View } from "react-native";

import { Text } from "@/components/ui/text";

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
    songTagsMap,
    anticipatedTrackCount = 8,
    hasNextPage = false,
    isLoadingNextPage = false,
    onLoadNextPage,
    showSort = true,
    sortOptions = DEFAULT_MUSIC_LIST_SORT_OPTIONS,
    initialSort = DEFAULT_SORT,
    onSortChange,
}: MusicListProps) {
    const [sort, setSort] = useState(initialSort);
    const isLoadingMoreRef = useRef(false);
    const displayedTracks = useMemo(
        () => (showSort ? sortTracks(tracks, sort) : tracks),
        [showSort, sort, tracks],
    );

    useEffect(() => {
        isLoadingMoreRef.current = isLoadingNextPage;
    }, [isLoadingNextPage]);

    const handleSortChange = useCallback(
        (nextSort: MusicListSort) => {
            setSort(nextSort);
            onSortChange?.(nextSort);
        },
        [onSortChange],
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
                <View className={showSort ? "px-6 pb-24" : "px-6 pb-10"}>
                    {Array.from({ length: anticipatedTrackCount }).map(
                        (_, index) => (
                            <MusicListItemSkeleton key={index} />
                        ),
                    )}
                </View>
            ) : (
                <FlatList
                    data={displayedTracks}
                    keyExtractor={(item, index) => item.id || index.toString()}
                    renderItem={({ item }) => (
                        <MusicListItem
                            item={item}
                            isThisTrackPlaying={
                                activeTrackId === item.id && isPlaying
                            }
                            onTogglePlayback={onTogglePlayback}
                            tags={item.id ? songTagsMap?.[item.id] : undefined}
                            onPress={onSelectTrack}
                        />
                    )}
                    contentContainerClassName={
                        showSort ? "px-6 pb-24" : "px-6 pb-10"
                    }
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

            {showSort && (
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
