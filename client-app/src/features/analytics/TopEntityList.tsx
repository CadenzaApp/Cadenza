import type { MusicItem } from "@apple-musickit";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Image, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useTracksForSongIds } from "@/lib/musickit-hooks";
import type { EntityPlayCount, TopDimension } from "@/lib/routes/analytics";
import { cn } from "@/lib/utils";

import { albumRouteFor, artistRouteFor } from "./entity-routes";
import { formatCount } from "./format";

type Props = {
    dimension: TopDimension;
    entries: readonly EntityPlayCount[];
    /** Shown when there is nothing to list. */
    emptyLabel: string;
    /** Round artwork, which is how the app draws an artist elsewhere. */
    roundArtwork?: boolean;
};

/**
 * A ranked list of songs, artists or albums with their play counts.
 *
 * Every row's artwork comes from its `sample_song_id`, all resolved in one
 * batch. For an album that is exactly the album's cover; for an artist it is the
 * cover of a song by them, which is a stand-in rather than a portrait.
 *
 * Used for the overview's preview cards and for the artist and album pages. The
 * songs page uses `MusicList` instead, since a song row should play.
 */
export function TopEntityList({
    dimension,
    entries,
    emptyLabel,
    roundArtwork,
}: Props) {
    const router = useRouter();
    const songIds = useMemo(
        () => entries.map((entry) => entry.sample_song_id),
        [entries],
    );
    const { tracks } = useTracksForSongIds(songIds);

    // tracks come back without the ones that did not resolve, so index rather
    // than zip: the nth row is not the nth track
    const tracksById = useMemo(() => {
        const byId = new Map<string, MusicItem>();
        for (const track of tracks) {
            for (const id of [track.id, track.catalogId, track.libraryId]) {
                if (id) byId.set(id, track);
            }
        }
        return byId;
    }, [tracks]);

    if (entries.length === 0) {
        return (
            <Text className="text-muted-foreground text-sm">{emptyLabel}</Text>
        );
    }

    return (
        <View className="gap-3">
            {entries.map((entry, index) => {
                const track = tracksById.get(entry.sample_song_id);
                const href =
                    dimension === "artist"
                        ? artistRouteFor(entry, track)
                        : dimension === "album"
                          ? albumRouteFor(entry, track)
                          : null;
                // a song's title lives in Apple Music, so fall back to the id
                // rather than dropping a row that earned its place
                const title = entry.label ?? track?.title ?? entry.key;
                const subtitle = entry.sub_label ?? track?.artistName;

                const row = (
                    <View className="flex-row items-center gap-3">
                        <Text className="text-muted-foreground w-4 text-xs">
                            {index + 1}
                        </Text>
                        <Artwork url={track?.artworkUrl} round={roundArtwork} />
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

                // a row with no id recorded anywhere has nowhere to go, so it
                // renders inert rather than navigating somewhere broken
                if (!href) return <View key={entry.key}>{row}</View>;

                return (
                    <Pressable
                        key={entry.key}
                        onPress={() => router.push(href)}
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

/** The same validity check and placeholder the music list rows use. */
function Artwork({ url, round }: { url?: string; round?: boolean }) {
    const trimmed = url?.trim();
    const usable = typeof trimmed === "string" && /^https?:\/\//i.test(trimmed);

    return usable ? (
        <Image
            source={{ uri: trimmed }}
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
