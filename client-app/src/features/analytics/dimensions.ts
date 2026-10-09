/**
 * The ranking dimensions the client knows how to draw, and where each one's rows
 * go when tapped.
 *
 * One descriptor per dimension, mirroring the backend's `Dimension::ALL`. The
 * preview cards, the detail route and each row's href all read this list, so a
 * new dimension is one entry here and one on the backend rather than a field, a
 * branch and a route file each.
 *
 * Pure, so `dimensions.test.ts` runs it under `node --test`. That is why the one
 * value import spells out `.ts`: `node --test` resolves no extensionless local
 * imports.
 */

import type { MusicItem } from "@apple-musickit";
import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

import { decodeQuerySource } from "../../lib/play-source.ts";
import type { EntityPlayCount, TopDimension } from "@/lib/routes/analytics";

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

export type PlaylistRoute = {
    pathname: "/collection/[kind]/[id]";
    params: { kind: "playlist"; id: string; title: string };
};

export type QueryRoute = {
    pathname: "/query-results";
    params: { query: string; suggested: string; name?: string };
};

export type DimensionRoute =
    | ArtistRoute
    | AlbumRoute
    | PlaylistRoute
    | QueryRoute;

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

/** The playlist's own page. No artwork is passed; the screen loads its own. */
export function playlistRouteFor(entity: RankedEntity): PlaylistRoute | null {
    if (!entity.entity_id) return null;
    return {
        pathname: "/collection/[kind]/[id]",
        params: {
            kind: "playlist",
            id: entity.entity_id,
            title: entity.label ?? "Playlist",
        },
    };
}

/** The query's results, run again. Null when the id is not a query. */
export function queryRouteFor(entity: RankedEntity): QueryRoute | null {
    const source = entity.entity_id
        ? decodeQuerySource(entity.entity_id)
        : null;
    if (!source) return null;
    return {
        pathname: "/query-results",
        params: {
            query: JSON.stringify(source.query),
            suggested: source.suggested ? "1" : "",
            name: entity.label ?? undefined,
        },
    };
}

export type { TopDimension };

export type DimensionDescriptor = {
    name: TopDimension;
    /** What the overview's ranking picker calls it. */
    label: string;
    /** The picker's icon for it. */
    icon: ComponentProps<typeof Ionicons>["name"];
    /** The title of the full list's own page. */
    pageTitle: string;
    emptyLabel: string;
    /** Artists are drawn round, the way the rest of the app draws them. */
    roundArtwork: boolean;
    /**
     * Fetch the row's own cover by its `entity_id` as this kind of collection.
     * Null uses the sample song's cover, which for an album already is the
     * album's.
     */
    artworkCollection: "album" | "playlist" | null;
    /**
     * Where a row goes, or null when no play of it recorded an id. A song row
     * plays rather than navigating, so songs have no href.
     */
    hrefFor:
        | ((entity: RankedEntity, sample?: MusicItem) => DimensionRoute | null)
        | null;
    /**
     * The full list. Songs have their own page, a playable `MusicList`; every
     * other dimension is the shared `[dimension]` route.
     */
    seeAllHref:
        | { pathname: "/analytics/songs" }
        | {
              pathname: "/analytics/[dimension]";
              params: { dimension: TopDimension };
          };
};

/** In the order the overview's picker shows them. */
export const DIMENSIONS: DimensionDescriptor[] = [
    {
        name: "song",
        label: "Songs",
        icon: "musical-note",
        pageTitle: "Most Played",
        emptyLabel: "No plays in this window yet.",
        roundArtwork: false,
        artworkCollection: null,
        // a song row plays, it does not navigate
        hrefFor: null,
        seeAllHref: { pathname: "/analytics/songs" },
    },
    {
        name: "playlist",
        label: "Playlists",
        icon: "list",
        pageTitle: "Most Played Playlists",
        emptyLabel: "Nothing played from a playlist in this window yet.",
        roundArtwork: false,
        artworkCollection: "playlist",
        hrefFor: playlistRouteFor,
        seeAllHref: rankingHref("playlist"),
    },
    {
        name: "album",
        label: "Albums",
        icon: "disc",
        pageTitle: "Most Listened Albums",
        emptyLabel: "No albums recorded in this window yet.",
        roundArtwork: false,
        artworkCollection: null,
        hrefFor: albumRouteFor,
        seeAllHref: rankingHref("album"),
    },
    {
        name: "artist",
        label: "Artists",
        icon: "person",
        pageTitle: "Most Listened Artists",
        emptyLabel: "No artists recorded in this window yet.",
        roundArtwork: true,
        artworkCollection: null,
        hrefFor: artistRouteFor,
        seeAllHref: rankingHref("artist"),
    },
    {
        name: "query",
        label: "Queries",
        icon: "funnel",
        pageTitle: "Most Played Queries",
        emptyLabel: "Nothing played from a query in this window yet.",
        roundArtwork: false,
        artworkCollection: null,
        hrefFor: queryRouteFor,
        seeAllHref: rankingHref("query"),
    },
];

function rankingHref(dimension: TopDimension) {
    return {
        pathname: "/analytics/[dimension]" as const,
        params: { dimension },
    };
}

export function dimensionByName(name: string): DimensionDescriptor | undefined {
    return DIMENSIONS.find((dimension) => dimension.name === name);
}
