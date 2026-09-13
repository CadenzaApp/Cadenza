import type { MusicItem } from "@apple-musickit";

/**
 * Hrefs into the resource screens, built in one place.
 *
 * These routes carry more than an id: the title and the artwork color are
 * passed along so the screen can draw its header and paint itself before its
 * own fetch lands. That is a params object worth exactly one definition rather
 * than one per caller.
 */

type CollectionRoute = {
    pathname: "/collection/[kind]/[id]";
    params: {
        kind: string;
        id: string;
        title: string;
        artistName?: string;
        artworkColor?: string;
        artworkUrl?: string;
        artworkUrlLarge?: string;
    };
};

/** The songs inside one album or playlist. */
export function collectionRoute(collection: MusicItem): CollectionRoute {
    return {
        // Collections are addressed by their library id; the plain id is the
        // catalog one when Apple knows of a catalog equivalent.
        pathname: "/collection/[kind]/[id]",
        params: {
            kind: collection.resourceKind,
            id: collection.libraryId ?? collection.id,
            title: collection.title,
            artistName: collection.artistName,
            artworkColor: collection.artworkColor,
            // The small one on purpose: this is what the tint is averaged
            // from, and averaging a 1200px cover downloads 1200px of cover.
            artworkUrl: collection.artworkUrl ?? collection.artworkUrlLarge,
            // The large one is the hero, which is the other thing the screen
            // draws before its own fetch lands.
            artworkUrlLarge: collection.artworkUrlLarge,
        },
    };
}

/**
 * The same screen for an album we only know through a song on it. A song's
 * artwork is the album cover, so its color is the album's color.
 */
export function albumRouteForTrack(track: MusicItem): CollectionRoute | null {
    if (!track.albumID) return null;
    return {
        pathname: "/collection/[kind]/[id]",
        params: {
            kind: "album",
            id: track.albumID,
            title: track.albumName ?? "Album",
            artistName: track.artistName,
            artworkColor: track.artworkColor,
            artworkUrl: track.artworkUrl ?? track.artworkUrlLarge,
            artworkUrlLarge: track.artworkUrlLarge,
        },
    };
}
