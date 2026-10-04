/**
 * The artist and album a listening event is about, and where it was started
 * from.
 *
 * The backend only ever stores a song id, so a ranking of artists or albums has
 * to read these off the event payload. Apple Music owns the metadata and the
 * client is the only side that has it at play time, which is why it is attached
 * here rather than looked up later.
 *
 * Pure apart from a type import, so `track-metadata.test.ts` runs it under
 * `node --test`.
 */

import type { MusicItem } from "@apple-musickit";

import type { PlaySource } from "./play-source";

/**
 * What `play_counted` carries so the backend can group by artist, album,
 * playlist and query.
 */
export type TrackMetadata = {
    artistName?: string;
    /** Apple Music catalog artist id. Absent for a library-only song. */
    artistId?: string;
    albumName?: string;
    /** Apple Music album id. Absent for a library-only song. */
    albumId?: string;
    /** The playlist or query the play came out of, when it came out of one. */
    source?: PlaySource;
};

/** A trimmed value, or undefined when there is nothing worth storing. */
function text(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

/**
 * The groupable metadata on a track. Empty strings and blank values are dropped
 * rather than stored, since the backend keys a group on the name and a blank
 * name is not a group.
 *
 * Note `albumID`, which is how `MusicItem` spells it, becomes `albumId` here so
 * both ids read the same way.
 *
 * `source` is passed in, since a track does not know where it was queued from.
 * A source with a blank id or name is dropped for the same reason as a blank
 * name.
 */
export function trackMetadata(
    track: MusicItem,
    source?: PlaySource | null,
): TrackMetadata {
    const metadata: TrackMetadata = {};

    const artistName = text(track.artistName);
    if (artistName) metadata.artistName = artistName;

    const artistId = text(track.artistId);
    if (artistId) metadata.artistId = artistId;

    const albumName = text(track.albumName);
    if (albumName) metadata.albumName = albumName;

    const albumId = text(track.albumID);
    if (albumId) metadata.albumId = albumId;

    const sourceId = text(source?.id);
    const sourceName = text(source?.name);
    if (source && sourceId && sourceName) {
        metadata.source = { kind: source.kind, id: sourceId, name: sourceName };
    }

    return metadata;
}
