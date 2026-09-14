import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";

import {
    PlayerPager,
    type FocusedSong,
} from "@/components/custom/media-player/player-pager";
import { DetailScreen } from "@/components/ui/detail-screen";
import { useArtworkTint } from "@/lib/artwork-color";
import { usePlayback } from "@/lib/playback";

export default function PlayerScreen() {
    const router = useRouter();
    const { activeTrack } = usePlayback();
    const { tint } = useArtworkTint(activeTrack);
    const params = useLocalSearchParams<{
        tagsSongId?: string;
        tagsSongTitle?: string;
        tagsArtworkUrl?: string;
        tagsArtworkColor?: string;
    }>();
    // Modify Tags on a song that is not playing opens straight here with a
    // target song, rather than through the mini player. The sheet has
    // something to show either way, so it must not auto-close for that case.
    const hasTagsTarget = Boolean(params.tagsSongId);

    // Playback can stop while the sheet is open. Close rather than sit here
    // showing an empty sheet, unless a Modify Tags target is why it is open.
    useEffect(() => {
        if (!activeTrack && !hasTagsTarget && router.canGoBack()) {
            router.back();
        }
    }, [activeTrack, hasTagsTarget, router]);

    if (!activeTrack && !hasTagsTarget) return null;

    const focusedSong: FocusedSong = hasTagsTarget
        ? {
              id: params.tagsSongId!,
              title: params.tagsSongTitle ?? "",
              artworkUrl: params.tagsArtworkUrl || undefined,
              artworkColor: params.tagsArtworkColor || undefined,
          }
        : {
              id: activeTrack!.catalogId ?? activeTrack!.id,
              title: activeTrack!.title,
              artworkUrl: activeTrack!.artworkUrl,
              artworkColor: activeTrack!.artworkColor,
          };

    return (
        <DetailScreen presentation="sheet" title="Now Playing" tint={tint}>
            <PlayerPager
                initialPage={hasTagsTarget ? "tags" : "player"}
                focusedSong={focusedSong}
            />
        </DetailScreen>
    );
}
