import type { MusicItem } from "@apple-musickit";
import { useCallback, useLayoutEffect, useMemo } from "react";
import { useNavigation } from "expo-router";
import { View } from "react-native";

import { MusicList } from "@/components/custom/music-list";
import { Text } from "@/components/ui/text";
import { useTracksForSongIds } from "@/lib/musickit-hooks";
import { usePlaybackCommands } from "@/lib/playback";
import { useAnalyticsTop, type EntityPlayCount } from "@/lib/routes/analytics";

import { useAnalyticsPeriod } from "./analytics-period";
import { formatCount } from "./format";
import { PeriodBar } from "./PeriodControls";

/**
 * The full most played songs list, as a real music list: tapping a row plays the
 * whole ranking from there, and every row has its options menu and tag rail.
 *
 * `MusicList` owns its own list and must be a flex-filling child, so the period
 * bar sits above it rather than scrolling with it.
 *
 * `useTracksForSongIds` drops ids Apple Music cannot resolve, so an unavailable
 * song falls out of the list rather than appearing without a title. It returns
 * what it does resolve in request order, which is already the ranking.
 */
export function TopSongsScreen() {
    const navigation = useNavigation();
    const { period } = useAnalyticsPeriod();
    const { playQueue } = usePlaybackCommands();
    const { top, topLoading } = useAnalyticsTop("song", {
        since: period.since,
        until: period.until,
    });

    useLayoutEffect(() => {
        navigation.setOptions({ title: "Most Played" });
    }, [navigation]);

    const entries = top?.entries ?? NO_ENTRIES;
    const songIds = useMemo(
        () => entries.map((entry) => entry.sample_song_id),
        [entries],
    );
    const { tracks, tracksLoading } = useTracksForSongIds(songIds);

    const playsBySong = useMemo(() => {
        const byId = new Map<string, number>();
        for (const entry of entries)
            byId.set(entry.sample_song_id, entry.plays);
        return byId;
    }, [entries]);

    // a tap plays the whole ranking from that row, rather than the one-song
    // queue a plain row tap would make
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
            const plays =
                playsBySong.get(track.catalogId ?? track.id) ??
                playsBySong.get(track.id);
            if (plays == null) return null;
            return (
                <Text className="text-muted-foreground text-xs">
                    {formatCount(plays)}
                </Text>
            );
        },
        [playsBySong],
    );

    return (
        <View className="flex-1 bg-background">
            <View className="px-5 pb-3 pt-5">
                <PeriodBar />
            </View>
            <MusicList
                tracks={tracks}
                isLoading={topLoading || tracksLoading}
                // ranked order is the point, so no sorting and no paging
                pagination={null}
                sorting={null}
                onTrackPressOverride={playFromRow}
                renderAccessory={renderAccessory}
                anticipatedTrackCount={Math.min(entries.length || 8, 20)}
                fullBleedRows
            />
        </View>
    );
}

/** Stable, so a pending read does not give the memos a new array each render. */
const NO_ENTRIES: EntityPlayCount[] = [];
