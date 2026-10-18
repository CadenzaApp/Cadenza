import { useLocalSearchParams } from "expo-router";

import { SongDiscussPage } from "@/components/custom/media-player/discuss-page";
import { DetailScreen } from "@/components/ui/detail-screen";
import { useArtworkTint } from "@/lib/artwork-color";

/**
 * Posts about one song, opened from a song's Discuss action.
 * It is not the now playing sheet: no "Now Playing" title and no Discuss /
 * Player / Tags selector. It does not start or replace playback.
 */
export default function SongDiscussScreen() {
    const params = useLocalSearchParams<{
        songId: string;
        title?: string;
        artworkUrl?: string;
        artworkColor?: string;
    }>();
    const songId = one(params.songId);
    const focusedSong = {
        id: songId,
        title: one(params.title),
        artworkUrl: one(params.artworkUrl) || undefined,
        artworkColor: one(params.artworkColor) || undefined,
    };
    const { tint } = useArtworkTint(songId ? focusedSong : null);
    if (!songId) return null;

    return (
        <DetailScreen title="Discuss" tint={tint}>
            <SongDiscussPage focusedSong={focusedSong} />
        </DetailScreen>
    );
}

function one(value: string | string[] | undefined): string {
    return (Array.isArray(value) ? value[0] : value) ?? "";
}
