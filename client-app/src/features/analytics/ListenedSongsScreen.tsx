import type { MusicItem } from "@apple-musickit";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { MusicList } from "@/components/custom/music-list";
import { Text } from "@/components/ui/text";
import { useTracksForSongIds } from "@/lib/musickit-hooks";
import { usePlaybackCommands } from "@/lib/playback";
import {
    useListeningSongs,
    type ListeningTag,
} from "@/lib/routes/analytics-listening";

import { formatDuration } from "./format";

/** Songs per read, and how many more each load asks for. */
const PAGE = 25;
/** The backend's cap on one read. */
const MAX_LIMIT = 100;

/**
 * Route params. Plain strings, so the page can be linked to or reopened.
 * `tag` is a tag id or `untagged`, left out for every song.
 */
export type ListenedSongsParams = {
    since: string;
    until: string;
    title: string;
    tag?: string;
};

/** The route params for a span and filter, for `router.push`. */
export function listenedSongsParams(
    window: { since: string; until: string },
    title: string,
    tag: ListeningTag,
): ListenedSongsParams {
    return {
        since: window.since,
        until: window.until,
        title,
        ...(tag === null ? {} : { tag: String(tag) }),
    };
}

/**
 * The songs listened to in one span, first played first, as a real music
 * list: a tap plays the list from that row, and every row has its options
 * menu, so the user can play, queue, tag, or go to an album from here.
 *
 * Opened from the heatmap's hour. Scrolling to the end loads more, up to the
 * backend's cap.
 */
export function ListenedSongsScreen() {
    const navigation = useNavigation();
    const params = useLocalSearchParams<ListenedSongsParams>();
    const window = { since: params.since, until: params.until };
    const tag = parseTag(params.tag);
    const { playQueue } = usePlaybackCommands();
    const [limit, setLimit] = useState(PAGE);
    const { data, isLoading, isValidating } = useListeningSongs(
        window,
        tag,
        limit,
    );

    useLayoutEffect(() => {
        navigation.setOptions({ title: params.title });
    }, [navigation, params.title]);

    const entries = data?.entries;
    const songIds = useMemo(
        () => entries?.map((song) => song.song_id) ?? [],
        [entries],
    );
    const { tracks, tracksLoading } = useTracksForSongIds(songIds);

    const msBySong = useMemo(
        () =>
            new Map(entries?.map((song) => [song.song_id, song.listening_ms])),
        [entries],
    );

    // a tap plays the span's songs from that row, not a one-song queue
    const playFromRow = useCallback(
        async (track: MusicItem) => {
            const startIndex = tracks.indexOf(track);
            await playQueue({
                tracks,
                startIndex: startIndex >= 0 ? startIndex : 0,
            });
        },
        [playQueue, tracks],
    );

    const renderAccessory = useCallback(
        (track: MusicItem) => {
            const ms =
                msBySong.get(track.catalogId ?? track.id) ??
                msBySong.get(track.id);
            if (ms == null) return null;
            return (
                <Text className="text-muted-foreground text-xs">
                    {formatDuration(ms)}
                </Text>
            );
        },
        [msBySong],
    );

    const canLoadMore = !!data?.has_more && limit < MAX_LIMIT;
    return (
        <View className="flex-1 bg-background">
            <MusicList
                tracks={tracks}
                isLoading={isLoading || tracksLoading}
                // play order is the point, so no sorting
                sorting={null}
                pagination={{
                    hasNextPage: canLoadMore,
                    isLoadingNextPage: canLoadMore && isValidating,
                    onLoadNextPage: () =>
                        setLimit((n) => Math.min(MAX_LIMIT, n + PAGE)),
                }}
                onTrackPressOverride={playFromRow}
                renderAccessory={renderAccessory}
                anticipatedTrackCount={8}
                fullBleedRows
            />
        </View>
    );
}

function parseTag(tag: string | undefined): ListeningTag {
    if (!tag) return null;
    if (tag === "untagged") return "untagged";
    const id = Number(tag);
    return Number.isInteger(id) && id > 0 ? id : null;
}
