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

export type SharedPlaylistRoute = {
    pathname: "/shared-playlist/[id]";
    params: { id: string };
};

export type DimensionRoute =
    | ArtistRoute
    | AlbumRoute
    | PlaylistRoute
    | QueryRoute
    | SharedPlaylistRoute;

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
 * The row's own id wins, then the sample track's. The sample carries the
 * artwork and color the screen paints itself with before its own fetch lands,
 * so those ride along only when the sample is on this same album.
 */
export function albumRouteFor(
    entity: RankedEntity,
    sample?: MusicItem,
): AlbumRoute | null {
    const id = entity.entity_id ?? sample?.albumID;
    if (!id) return null;
    const onAlbum = sample?.albumID === id ? sample : undefined;
    return {
        pathname: "/collection/[kind]/[id]",
        params: {
            kind: "album",
            id,
            title: entity.label ?? onAlbum?.albumName ?? "Album",
            artistName: entity.sub_label ?? onAlbum?.artistName,
            artworkColor: onAlbum?.artworkColor,
            // the small one: this is what the tint is averaged from
            artworkUrl: onAlbum?.artworkUrl ?? onAlbum?.artworkUrlLarge,
            artworkUrlLarge: onAlbum?.artworkUrlLarge,
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

/** The shared playlist's page, in the tab it opens from. */
export function sharedPlaylistRouteFor(
    entity: RankedEntity,
): SharedPlaylistRoute | null {
    if (!entity.entity_id) return null;
    return {
        pathname: "/shared-playlist/[id]",
        params: { id: entity.entity_id },
    };
}

export type { TopDimension };

/**
 * The Apple Music resource a row is, so it can show that resource's picture
 * and open it. Its id is, in order: the one a play recorded, an exact name
 * match from a catalog search, then the sample song's. The sample comes last
 * because a song can sit on several albums.
 */
export type OwnSource = {
    kind: "album" | "playlist" | "artist";
    /** Searched by name when no play recorded the id. */
    search?: "artists" | "albums";
    sampleIdFor?: (sample: MusicItem) => string | undefined;
};

/** What a catalog search finds for a row, to hold against its names. */
export type FoundByName = { name: string; artistName?: string };

/** What to search the catalog for to find the row by name. */
export function searchTermFor(entity: RankedEntity): string | undefined {
    if (!entity.label) return undefined;
    return entity.sub_label
        ? `${entity.label} ${entity.sub_label}`
        : entity.label;
}

/**
 * Whether a search result is this row: the same name, and the same artist when
 * both say one. Case and outer spaces aside, since the backend groups that way.
 */
export function matchesByName(
    entity: RankedEntity,
    found: FoundByName,
): boolean {
    const same = (a: string, b: string) =>
        a.trim().toLowerCase() === b.trim().toLowerCase();
    if (!entity.label || !same(found.name, entity.label)) return false;
    if (entity.sub_label && found.artistName) {
        return same(found.artistName, entity.sub_label);
    }
    return true;
}

/** What a row's second line can be made from. */
export type SubtitleContext = {
    entity: RankedEntity;
    /** The row's sample song, once Apple Music resolved it. */
    sample?: MusicItem;
    /** Who Apple says made the row's own resource, like a playlist's curator. */
    ownCreator?: string;
    /** The caller's username. */
    myName?: string;
};

export type DimensionDescriptor = {
    name: TopDimension;
    /** The title of the full list's own page. */
    pageTitle: string;
    emptyLabel: string;
    /** A row's second line, or undefined for none. */
    subtitleFor: (context: SubtitleContext) => string | undefined;
    /** Artists are drawn round, the way the rest of the app draws them. */
    roundArtwork: boolean;
    /**
     * The resource a row is, for its picture and its id: an album, a playlist,
     * an artist. Null, or a row it finds nothing for, shows the sample song's
     * cover.
     */
    own: OwnSource | null;
    /** The row's title, when it is worded from the label. Else the label. */
    titleFor?: (entity: RankedEntity) => string;
    /**
     * A row that is a person: its label is their username, drawn as their
     * initials in place of art, and its id is their user id, whose profile a
     * tap opens.
     */
    person?: boolean;
    /**
     * Where a row goes, or null when no play of it recorded an id. A song row
     * plays rather than navigating, so songs have no href, and neither does a
     * person, who opens their profile.
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

/** In the order the overview's shelves show them. */
export const DIMENSIONS: DimensionDescriptor[] = [
    {
        name: "song",
        pageTitle: "Most Played Songs",
        emptyLabel: "No plays in this window yet.",
        subtitleFor: ({ sample }) => sample?.artistName,
        roundArtwork: false,
        own: null,
        // a song row plays, it does not navigate
        hrefFor: null,
        seeAllHref: { pathname: "/analytics/songs" },
    },
    {
        name: "artist",
        pageTitle: "Most Listened Artists",
        emptyLabel: "No artists recorded in this window yet.",
        subtitleFor: () => undefined,
        roundArtwork: true,
        own: {
            kind: "artist",
            search: "artists",
            sampleIdFor: (sample) => sample.artistId,
        },
        hrefFor: artistRouteFor,
        seeAllHref: rankingHref("artist"),
    },
    {
        name: "album",
        pageTitle: "Most Listened Albums",
        emptyLabel: "No albums recorded in this window yet.",
        subtitleFor: ({ entity, sample }) =>
            entity.sub_label ?? sample?.artistName,
        roundArtwork: false,
        own: {
            kind: "album",
            search: "albums",
            sampleIdFor: (sample) => sample.albumID,
        },
        hrefFor: albumRouteFor,
        seeAllHref: rankingHref("album"),
    },
    {
        name: "playlist",
        pageTitle: "Most Played Playlists",
        emptyLabel: "Nothing played from a playlist in this window yet.",
        subtitleFor: ({ entity, ownCreator, myName }) =>
            // Apple names a curator; a library playlist without one is yours
            ownCreator ??
            (entity.entity_id?.startsWith("p.") ? myName : undefined),
        roundArtwork: false,
        own: { kind: "playlist" },
        hrefFor: playlistRouteFor,
        seeAllHref: rankingHref("playlist"),
    },
    {
        name: "query",
        pageTitle: "Most Played Queries",
        emptyLabel: "Nothing played from a query in this window yet.",
        subtitleFor: () => undefined,
        roundArtwork: false,
        own: null,
        hrefFor: queryRouteFor,
        seeAllHref: rankingHref("query"),
    },
    {
        name: "shared_playlist",
        pageTitle: "Most Played Shared Playlists",
        emptyLabel: "Nothing played from a shared playlist in this window yet.",
        subtitleFor: ({ entity }) => entity.sub_label ?? undefined,
        roundArtwork: false,
        own: null,
        hrefFor: sharedPlaylistRouteFor,
        seeAllHref: rankingHref("shared_playlist"),
    },
    {
        name: "live_session",
        pageTitle: "Most Played Live Sessions",
        emptyLabel: "Nothing played in a live session in this window yet.",
        // the backend bins every session by its host
        titleFor: (entity) =>
            entity.label ? `${entity.label}'s session` : "A session",
        person: true,
        subtitleFor: () => undefined,
        roundArtwork: true,
        own: null,
        hrefFor: null,
        seeAllHref: rankingHref("live_session"),
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
