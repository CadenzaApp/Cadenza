import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import { TrackCollectionView } from "@/components/custom/track-collection-view";
import { useCollectionArtworkTint } from "@/components/custom/use-collection-artwork-tint";
import { FloatingBackButton } from "@/components/ui/floating-back-button";
import { Text } from "@/components/ui/text";
import { matchCountLabel } from "@/features/query-builder/QueryUtils";
import {
    COVER_SONG_COUNT,
    useArrangedTrackList,
} from "@/lib/arranged-track-list";
import { usePagedTracksForSongIds, useTrackLookup } from "@/lib/musickit-hooks";
import { usePlayAll } from "@/lib/play-all";
import type { ArrangeSource } from "@/lib/routes/arrange";
import {
    isArranged,
    NO_ARRANGEMENT,
    type SongArrangement,
} from "@/lib/song-arrangement";

const HERO_BUTTON_SIZE = 52;

/**
 * A plain list of songs by id, opened from the AI Assistant's song card
 * ("Open list"). Shows every song the card holds, in its order, with sort,
 * group, multiselect and the song menu. Plays here are not credited to a
 * query, since no query made the list.
 *
 * Params: `ids`, the song ids joined by commas (at most the backend's
 * `MAX_CARD_SONGS`, 250); `total`, how many matched in all, which can be more;
 * `capped`, "1" when even that total is a lower bound.
 */
export default function SongListScreen() {
    const params = useLocalSearchParams<{
        ids?: string;
        total?: string;
        capped?: string;
    }>();
    const songIds = useMemo(() => parseIds(params.ids), [params.ids]);
    const total = Math.max(Number(params.total) || 0, songIds.length);
    const capped = params.capped === "1";

    // starts unsorted every time the screen opens, and is never saved
    const [arrangement, setArrangement] =
        useState<SongArrangement>(NO_ARRANGEMENT);
    const arranged = isArranged(arrangement);
    const source = useMemo<ArrangeSource | null>(
        () => (songIds.length > 0 ? { kind: "songs", songIds } : null),
        [songIds],
    );
    const lookupTracks = useTrackLookup();
    const resetArrangement = useCallback(
        () => setArrangement(NO_ARRANGEMENT),
        [setArrangement],
    );
    const list = useArrangedTrackList({
        source,
        arrangement,
        lookupTracks,
        onRejected: resetArrangement,
    });
    // unsorted, the ids are paged in here in the card's order, the same as a
    // saved query's songs
    const pages = usePagedTracksForSongIds(songIds, !arranged);

    const tracks = arranged
        ? list.sections
            ? list.shownTracks
            : list.tracks
        : pages.tracks;
    const resolvePlayQueue = useCallback(
        async () =>
            arranged ? list.shownTracks : pages.resolveTracks(songIds),
        [arranged, list.shownTracks, pages, songIds],
    );
    const { play, shuffle } = usePlayAll({ resolveQueue: resolvePlayQueue });

    const coverSongs = useMemo(
        () => tracks.slice(0, COVER_SONG_COUNT),
        [tracks],
    );
    const cover = useCollectionArtworkTint(coverSongs);
    const loading = arranged ? list.loading : pages.tracksLoading;

    return (
        <TrackCollectionView
            title="AI Assistant"
            tracks={tracks}
            isLoading={loading}
            error={arranged ? list.error : pages.tracksErr}
            anticipatedTrackCount={songIds.length}
            summary={matchCountLabel(total, capped)}
            pagination={
                arranged
                    ? list.pagination
                    : {
                          hasNextPage: pages.hasNextPage,
                          isLoadingNextPage: pages.isLoadingNextPage,
                          onLoadNextPage: pages.loadNextPage,
                      }
            }
            sections={arranged ? list.sections : null}
            arrangement={{
                value: arrangement,
                onChange: setArrangement,
                sortValues: list.sortValues,
            }}
            footer={
                !loading && total > songIds.length ? (
                    <Text className="px-6 py-4 text-center text-sm text-muted-foreground">
                        {`These are the first ${songIds.length.toLocaleString()} of the ${total.toLocaleString()}${capped ? "+" : ""} songs the assistant found. Ask it to narrow the search to see others.`}
                    </Text>
                ) : null
            }
            respectTopSafeArea
            backControl={<FloatingBackButton size={HERO_BUTTON_SIZE} />}
            multiSelect={{}}
            showTags
            backgroundColor={cover.tint}
            artworkUrls={cover.artworkUrls}
            onPlay={play}
            onShuffle={shuffle}
        />
    );
}

function parseIds(value?: string): string[] {
    if (!value) return [];
    return value.split(",").filter((id) => id.length > 0);
}
