import Ionicons from "@expo/vector-icons/Ionicons";
import type { Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { ArtworkMosaic } from "@/components/custom/artwork-mosaic";
import { Text } from "@/components/ui/text";
import { useSongInfo } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import { useAppTheme } from "@/lib/theme";
import type { PostSharedPlaylist } from "@/lib/types";

const ARTWORK_SIZE = 64;

function plural(count: number, word: string) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A shared playlist attached to a post: cover, name, song and member counts.
 * Opens the playlist; someone who is not a member gets its private screen,
 * with a way to enter a code. A playlist that no longer exists shows as
 * unavailable and does not open.
 */
export function SharedPlaylistPostCard({
    playlist,
}: {
    playlist: PostSharedPlaylist;
}) {
    const { colors } = useAppTheme();
    const openScreen = useOpenScreen();
    const unavailable = !playlist.available;
    const { songInfo } = useSongInfo(
        !unavailable && playlist.cover_song_ids.length > 0
            ? playlist.cover_song_ids
            : null,
    );
    const artworkUrls = useMemo(
        () =>
            playlist.cover_song_ids.flatMap((id) => {
                const song = songInfo.find(
                    (info) => info.id === id || info.catalogId === id,
                );
                return song?.artworkUrl ? [song.artworkUrl] : [];
            }),
        [playlist.cover_song_ids, songInfo],
    );

    const body = (
        <>
            <ArtworkMosaic
                artworkUrls={unavailable ? [] : artworkUrls}
                size={ARTWORK_SIZE}
                placeholderColor={colors.muted}
            />
            <View className="min-w-0 flex-1 justify-center px-3">
                <Text
                    className="text-base font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {unavailable ? "[unavailable playlist]" : playlist.name}
                </Text>
                <Text
                    className="text-xs text-muted-foreground"
                    numberOfLines={1}
                >
                    {unavailable
                        ? "It might have been deleted."
                        : `${plural(playlist.song_count, "song")} · ${plural(playlist.member_count, "member")}`}
                </Text>
            </View>
        </>
    );

    if (unavailable) {
        return (
            <View
                accessibilityLabel="Unavailable playlist"
                className="flex-row items-center overflow-hidden rounded-lg bg-muted"
            >
                {body}
            </View>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open shared playlist ${playlist.name}`}
            onPress={(event) => {
                event.stopPropagation();
                openScreen(`/shared-playlist/${playlist.playlist_id}` as Href);
            }}
            className="flex-row items-center overflow-hidden rounded-lg bg-muted active:opacity-80"
        >
            {body}
            <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.mutedForeground}
                style={{ marginRight: 12 }}
            />
        </Pressable>
    );
}
