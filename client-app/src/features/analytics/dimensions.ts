/**
 * The ranking dimensions the client knows how to draw, and where each one's rows
 * go when tapped.
 *
 * One descriptor per dimension, mirroring the backend's `Dimension::ALL`. The
 * preview cards, the detail route and each row's href all read this list, so a
 * new dimension is one entry here and one on the backend rather than a field, a
 * branch and a route file each.
 *
 * The href builders live here rather than in their own module so this stays a
 * single pure file: `node --test` resolves no extensionless local imports, and a
 * value import across two files would need one.
 *
 * Pure apart from types, so `dimensions.test.ts` runs it under `node --test`.
 */

import type { MusicItem } from "@apple-musickit";

import type { EntityPlayCount } from "@/lib/routes/analytics";

/** What a ranking row carries. The api type, so the two cannot drift. */
export type RankedEntity = Pick<
    EntityPlayCount,
    "key" | "label" | "sub_label" | "entity_id"
>;

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

export type TopDimension = "song" | "artist" | "album";

export type DimensionDescriptor = {
    name: TopDimension;
    /** The heading on the overview's preview card. */
    previewTitle: string;
    /** The title of the full list's own page. */
    pageTitle: string;
    emptyLabel: string;
    /** Artists are drawn round, the way the rest of the app draws them. */
    roundArtwork: boolean;
    /**
     * Where a row goes, or null when no play of it recorded an id. A song row
     * plays rather than navigating, so songs have no href.
     */
    hrefFor:
        | ((
              entity: RankedEntity,
              sample?: MusicItem,
          ) => ArtistRoute | AlbumRoute | null)
        | null;
};

/** In the order the overview shows them. */
export const DIMENSIONS: DimensionDescriptor[] = [
    {
        name: "song",
        previewTitle: "Most played",
        pageTitle: "Most Played",
        emptyLabel: "No plays in this window yet.",
        roundArtwork: false,
        // a song row plays, it does not navigate
        hrefFor: null,
    },
    {
        name: "artist",
        previewTitle: "Most listened artists",
        pageTitle: "Most Listened Artists",
        emptyLabel: "No artists recorded in this window yet.",
        roundArtwork: true,
        hrefFor: artistRouteFor,
    },
    {
        name: "album",
        previewTitle: "Most listened albums",
        pageTitle: "Most Listened Albums",
        emptyLabel: "No albums recorded in this window yet.",
        roundArtwork: false,
        hrefFor: albumRouteFor,
    },
];

export function dimensionByName(name: string): DimensionDescriptor | undefined {
    return DIMENSIONS.find((dimension) => dimension.name === name);
}
