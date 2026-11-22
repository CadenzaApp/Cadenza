import type { MusicItem } from "@apple-musickit";

function artworkUrl(track: MusicItem) {
    return track.artworkUrlLarge?.trim() || track.artworkUrl?.trim();
}

/** The representative tracks behind the distinct, weighted artwork ranking. */
export function rankedArtworkTracks(tracks: readonly MusicItem[]) {
    const representativeByUrl = new Map<string, MusicItem>();
    tracks.forEach((track) => {
        const url = artworkUrl(track);
        if (url && !representativeByUrl.has(url)) {
            representativeByUrl.set(url, track);
        }
    });

    return rankedArtworkUrls(tracks).flatMap((url) => {
        const track = representativeByUrl.get(url);
        return track ? [track] : [];
    });
}

/** Ranks distinct artwork by total listening time plus one minute per track. */
export function rankedArtworkUrls(tracks: readonly MusicItem[]) {
    const artwork = new Map<
        string,
        { weightSeconds: number; firstTrackIndex: number }
    >();

    tracks.forEach((track, index) => {
        const url = artworkUrl(track);
        if (!url) return;

        const current = artwork.get(url);
        const weightSeconds = Math.max(0, track.songDuration ?? 0) + 60;
        artwork.set(url, {
            weightSeconds: (current?.weightSeconds ?? 0) + weightSeconds,
            firstTrackIndex: current?.firstTrackIndex ?? index,
        });
    });

    return [...artwork.entries()]
        .sort(
            ([, left], [, right]) =>
                right.weightSeconds - left.weightSeconds ||
                left.firstTrackIndex - right.firstTrackIndex,
        )
        .map(([url]) => url);
}

/** Always returns four cells when at least one artwork is available. */
export function collectionArtworkGrid(tracks: readonly MusicItem[]) {
    return collectionArtworkGridTracks(tracks).flatMap((track) => {
        const url = artworkUrl(track);
        return url ? [url] : [];
    });
}

/** Tracks whose colors correspond one-for-one with the artwork grid cells. */
export function collectionArtworkGridTracks(tracks: readonly MusicItem[]) {
    const ranked = rankedArtworkTracks(tracks).slice(0, 4);
    if (ranked.length === 0) return [];
    if (ranked.length === 1) return ranked;
    return Array.from(
        { length: 4 },
        (_, index) => ranked[index % ranked.length],
    );
}

export function formatTrackCollectionSummary(tracks: readonly MusicItem[]) {
    const totalSeconds = Math.max(
        0,
        Math.round(
            tracks.reduce(
                (total, track) => total + Math.max(0, track.songDuration ?? 0),
                0,
            ),
        ),
    );
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const durationParts = [
        hours > 0 ? `${hours} hr` : null,
        minutes > 0 ? `${minutes} min` : null,
        `${seconds} sec`,
    ].filter(Boolean);

    return `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} (${durationParts.join(" ")})`;
}

/**
 * Song count and running time, shown under the header metadata once all pages load. Reads
 * whatever durations are there: a song missing one adds nothing to the total
 * rather than voiding it.
 */
export function collectionSummary(
    tracks: readonly MusicItem[],
    count = tracks.length,
) {
    const songs = `${count} ${count === 1 ? "song" : "songs"}`;
    const seconds = tracks.reduce(
        (total, track) => total + (track.songDuration ?? 0),
        0,
    );
    if (seconds <= 0) return songs;

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${songs}, ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    }

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
    return rest === 0
        ? `${songs}, ${hourText}`
        : `${songs}, ${hourText} ${rest} ${rest === 1 ? "minute" : "minutes"}`;
}

/** A playlist describes its curator; a track can only supply album metadata. */
export function collectionHeaderMetadata(
    kind: "album" | "playlist",
    creatorOrArtist?: string,
    collection?: MusicItem,
    firstTrack?: MusicItem,
) {
    if (kind === "playlist") {
        return {
            subtitle: creatorOrArtist || collection?.artistName,
            summary: "",
        };
    }
    const genre = firstTrack?.genres?.[0];
    const year = firstTrack?.releaseDate
        ? new Date(firstTrack.releaseDate).getUTCFullYear()
        : undefined;
    return {
        subtitle: creatorOrArtist || firstTrack?.artistName,
        summary: [genre, year].filter(Boolean).join(" · ") || undefined,
    };
}
