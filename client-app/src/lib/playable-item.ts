import type { MusicItem } from "@apple-musickit";

/** Every identifier that may name the same library/catalog playable item. */
export function playableIdentifiers(item: MusicItem) {
    return new Set(
        [item.id, item.playbackId, item.catalogId, item.libraryId].filter(
            (id): id is string => typeof id === "string" && id.trim() !== "",
        ),
    );
}

/** Matches library and catalog representations of the same playable item. */
export function samePlayableItem(left: MusicItem, right: MusicItem) {
    const leftIds = playableIdentifiers(left);
    return [...playableIdentifiers(right)].some((id) => leftIds.has(id));
}

/** Whether a track belongs to a currently displayed collection. */
export function isTrackInCollection(
    track: MusicItem,
    collectionId: string,
    kind: "album" | "playlist",
    loadedTracks: readonly MusicItem[],
) {
    if (kind === "album" && track.albumID === collectionId) return true;
    return loadedTracks.some((candidate) => samePlayableItem(candidate, track));
}
