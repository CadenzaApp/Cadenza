/**
 * Where a ranking row goes when it is tapped.
 *
 * A row knows the entity id only when some play of it recorded one, which a
 * library-only copy does not. So every one of these can return null, and a row
 * with nowhere to go renders inert rather than navigating somewhere broken. That
 * is the same guard `artist-list.tsx` already exposes as `canOpenArtist`.
 *
 * Pure apart from types, so `entity-routes.test.ts` runs it under `node --test`.
 */

import type { MusicItem } from "@apple-musickit";

/** Just the fields a ranking row carries, so this needs no api types. */
export type RankedEntity = {
    key: string;
    label: string | null;
    sub_label: string | null;
    entity_id: string | null;
};

export type ArtistRoute = {
    pathname: "/artist/[id]";
    params: { id: string; name?: string };
};

export type AlbumRoute = {
    pathname: "/collection/[kind]/[id]";
    params: {
        kind: "album";
        id: string;
        title: string;
        artistName?: string;
        artworkColor?: string;
        artworkUrl?: string;
        artworkUrlLarge?: string;
    };
};

/**
 * The artist page for a ranking row, or null when no play of it recorded a
 * catalog artist id.
 *
 * `sample` is the track the row's artwork came from; its `artistId` is a second
 * chance at the id for a row whose own plays were all library copies.
 */
export function artistRouteFor(
    entity: RankedEntity,
    sample?: MusicItem,
): ArtistRoute | null {
    const id = entity.entity_id ?? sample?.artistId;
    if (!id) return null;
    return {
        pathname: "/artist/[id]",
        params: { id, name: entity.label ?? undefined },
    };
}

/**
 * The album page for a ranking row.
 *
 * Prefers the sample track, which carries the artwork and color the screen
 * paints itself with before its own fetch lands. Falls back to the row's own id
 * when the track did not resolve, which still opens the right album, just
 * without the head start.
 */
export function albumRouteFor(
    entity: RankedEntity,
    sample?: MusicItem,
): AlbumRoute | null {
    const id = sample?.albumID ?? entity.entity_id;
    if (!id) return null;
    return {
        pathname: "/collection/[kind]/[id]",
        params: {
            kind: "album",
            id,
            title: entity.label ?? sample?.albumName ?? "Album",
            artistName: entity.sub_label ?? sample?.artistName,
            artworkColor: sample?.artworkColor,
            // the small one: this is what the tint is averaged from
            artworkUrl: sample?.artworkUrl ?? sample?.artworkUrlLarge,
            artworkUrlLarge: sample?.artworkUrlLarge,
        },
    };
}
