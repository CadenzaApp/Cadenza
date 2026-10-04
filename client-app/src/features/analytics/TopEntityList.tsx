import type { MusicItem } from "@apple-musickit";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Image, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { indexTracksById, useTracksForSongIds } from "@/lib/musickit-hooks";
import { usePlaybackCommands } from "@/lib/playback";
import type { EntityPlayCount } from "@/lib/routes/analytics";
import { cn, isUsableArtworkUrl } from "@/lib/utils";

import type { DimensionDescriptor } from "./dimensions";
import { formatCount } from "./format";

type Props = {
    dimension: DimensionDescriptor;
    entries: readonly EntityPlayCount[];
};

/**
 * A ranked list of whatever a dimension ranks, with play counts.
 *
 * Every row's artwork comes from its `sample_song_id`, all resolved in one
 * batch. For an album that is exactly the album's cover; for anything else it
 * is the cover of one of its songs, a stand-in rather than its own art.
 *
 * A row opens what the descriptor's `hrefFor` says. A dimension with no href
 * builder ranks songs, so its row plays the list from that song instead.
 *
 * Used for the overview's rankings card and for every full ranking but songs,
 * which gets a `MusicList` with options menus and tag rails.
 */
export function TopEntityList({ dimension, entries }: Props) {
    const router = useRouter();
    const { playQueue } = usePlaybackCommands();
    const songIds = useMemo(
        () => entries.map((entry) => entry.sample_song_id),
        [entries],
    );
    const { tracks } = useTracksForSongIds(songIds);

    // tracks come back without the ones that did not resolve, so index rather
    // than zip: the nth row is not the nth track
    const tracksById = useMemo(() => indexTracksById(tracks), [tracks]);

    // the resolved tracks are already in rank order, so the queue is the
    // ranking from the tapped row down, with the rows above it behind
    const playFrom = useCallback(
        async (track: MusicItem) => {
            const startIndex = tracks.indexOf(track);
            try {
                await playQueue({
                    tracks,
                    startIndex: startIndex >= 0 ? startIndex : 0,
                });
            } catch {
                // the playback provider owns the user-facing error
            }
        },
        [playQueue, tracks],
    );

    if (entries.length === 0) {
        return (
            <Text className="text-muted-foreground text-sm">
                {dimension.emptyLabel}
            </Text>
        );
    }

    return (
        <View className="gap-3">
            {entries.map((entry, index) => {
                const track = tracksById.get(entry.sample_song_id);
                // the descriptor says where a row goes, so there is no branch
                // on the dimension here
                const href = dimension.hrefFor?.(entry, track) ?? null;
                // a song's title lives in Apple Music, so fall back to the id
                // rather than dropping a row that earned its place
                const title = entry.label ?? track?.title ?? entry.key;
                const subtitle = entry.sub_label ?? track?.artistName;

                const row = (
                    <View className="flex-row items-center gap-3">
                        <Text className="text-muted-foreground w-4 text-xs">
                            {index + 1}
                        </Text>
                        <Artwork
                            url={track?.artworkUrl}
                            round={dimension.roundArtwork}
                        />
                        <View className="flex-1">
                            <Text className="text-sm" numberOfLines={1}>
                                {title}
                            </Text>
                            {subtitle ? (
                                <Text
                                    className="text-muted-foreground text-xs"
                                    numberOfLines={1}
                                >
                                    {subtitle}
                                </Text>
                            ) : null}
                        </View>
                        <Text className="text-sm font-medium">
                            {formatCount(entry.plays)}
                        </Text>
                    </View>
                );

                const onPress = dimension.hrefFor
                    ? href && (() => router.push(href))
                    : track && (() => void playFrom(track));

                // a row with no id recorded anywhere, or a song Apple Music
                // could not resolve, has nothing to open, so it renders inert
                if (!onPress) return <View key={entry.key}>{row}</View>;

                return (
                    <Pressable
                        key={entry.key}
                        onPress={onPress}
                        accessibilityRole="button"
                        accessibilityLabel={`${title}, ${formatCount(entry.plays)} plays`}
                    >
                        {row}
                    </Pressable>
                );
            })}
        </View>
    );
}

const ARTWORK_SIZE = 40;

/** The same placeholder the music list rows use. */
function Artwork({ url, round }: { url?: string; round?: boolean }) {
    return isUsableArtworkUrl(url) ? (
        <Image
            source={{ uri: url?.trim() }}
            style={{
                width: ARTWORK_SIZE,
                height: ARTWORK_SIZE,
                borderRadius: round ? ARTWORK_SIZE / 2 : 4,
            }}
        />
    ) : (
        <View
            className={cn("bg-muted", round ? "rounded-full" : "rounded")}
            style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }}
        />
    );
}
