import type { MusicItem } from "@apple-musickit";
import { useCallback, useMemo } from "react";

import {
    indexTracksById,
    useArtistsInfo,
    useCatalogSearches,
    useCollectionsInfo,
    useTracksForSongIds,
} from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import { useOpenSocialProfile } from "@/lib/use-open-social-profile";
import { useProfile } from "@/lib/routes/profile";
import { usePlaybackCommands } from "@/lib/playback";
import type { EntityPlayCount } from "@/lib/routes/analytics";
import { isUsableArtworkUrl } from "@/lib/utils";

import {
    matchesByName,
    searchTermFor,
    type DimensionDescriptor,
    type OwnSource,
} from "./dimensions";

/** One ranking row, ready to draw as a list row or a tile. */
export type RankedRow = {
    key: string;
    /** 1 based. */
    rank: number;
    title: string;
    subtitle?: string;
    artworkUrl?: string;
    /** A person's username, drawn as their initials in place of art. */
    initialsOf?: string;
    plays: number;
    /** Null when there is nothing to open or play, so the row draws inert. */
    onPress: (() => void) | null;
};

/**
 * A dimension's ranking entries as rows: title, artwork and what a tap does.
 *
 * A row the descriptor's `own` names a resource for (an album, a playlist, an
 * artist) resolves that resource's id, then shows its picture and opens it.
 * Otherwise, or when Apple has no picture, it shows its `sample_song_id`'s
 * cover, resolved in one batch.
 *
 * A person row opens their profile. Any other row opens what the descriptor's
 * `hrefFor` says. A dimension with no href
 * builder ranks songs, so its row plays the ranking from that song instead.
 */
export function useRankedRows(
    dimension: DimensionDescriptor,
    entries: readonly EntityPlayCount[],
): RankedRow[] {
    const openScreen = useOpenScreen();
    const openProfile = useOpenSocialProfile();
    const { playQueue } = usePlaybackCommands();
    const songIds = useMemo(
        () => entries.map((entry) => entry.sample_song_id),
        [entries],
    );
    const { tracks } = useTracksForSongIds(songIds);

    // tracks come back without the ones that did not resolve, so index rather
    // than zip: the nth row is not the nth track
    const tracksById = useMemo(() => indexTracksById(tracks), [tracks]);

    const ownIds = useOwnIds(dimension.own, entries, tracksById);
    const ownById = useOwnResources(dimension.own?.kind, ownIds);
    const { profile } = useProfile();
    const myName = profile?.username;

    // the resolved tracks are already in rank order, so the queue is the
    // ranking from the tapped row down, with the rows above it behind
    const playFrom = useCallback(
        async (track: MusicItem) => {
            const startIndex = tracks.indexOf(track);
            try {
                await playQueue({
                    tracks,
                    startIndex: startIndex >= 0 ? startIndex : 0,
                    chosenStart: true,
                });
            } catch {
                // the playback provider owns the user-facing error
            }
        },
        [playQueue, tracks],
    );

    return useMemo(
        () =>
            entries.map((entry, index) => {
                const track = tracksById.get(entry.sample_song_id);
                const ownId = ownIds[index];
                const own = ownId ? ownById.get(ownId) : undefined;
                // the descriptor says where a row goes, so there is no branch
                // on the dimension here. It opens the resolved resource
                const href =
                    dimension.hrefFor?.(
                        ownId ? { ...entry, entity_id: ownId } : entry,
                        track,
                    ) ?? null;
                const personId = dimension.person ? entry.entity_id : null;
                const onPress = dimension.person
                    ? personId && (() => openProfile(personId))
                    : dimension.hrefFor
                      ? href && (() => openScreen(href))
                      : track && (() => void playFrom(track));
                return {
                    key: entry.key,
                    rank: index + 1,
                    // a song's title lives in Apple Music, so fall back to the
                    // id rather than dropping a row that earned its place
                    title:
                        dimension.titleFor?.(entry) ??
                        entry.label ??
                        track?.title ??
                        entry.key,
                    subtitle: dimension.subtitleFor({
                        entity: entry,
                        sample: track,
                        ownCreator: own?.creator,
                        myName,
                    }),
                    artworkUrl: own?.artworkUrl ?? track?.artworkUrl,
                    initialsOf: dimension.person
                        ? (entry.label ?? undefined)
                        : undefined,
                    plays: entry.plays,
                    // a row with no id recorded anywhere, or a song Apple
                    // Music could not resolve, has nothing to open
                    onPress: onPress || null,
                };
            }),
        [
            entries,
            tracksById,
            ownIds,
            ownById,
            myName,
            dimension,
            openScreen,
            openProfile,
            playFrom,
        ],
    );
}

/**
 * Each row's own resource id, by the order `OwnSource` gives: the id a play
 * recorded, an exact name match from a catalog search, then the sample song's.
 * Only rows with no recorded id are searched. A row still being searched has
 * no id yet, so it cannot open a sample's guess in the meantime.
 */
function useOwnIds(
    own: OwnSource | null,
    entries: readonly EntityPlayCount[],
    tracksById: Map<string, MusicItem>,
): (string | undefined)[] {
    const terms = useMemo(
        () =>
            entries.map((entry) =>
                own?.search && !entry.entity_id
                    ? (searchTermFor(entry) ?? null)
                    : null,
            ),
        [own, entries],
    );
    const { searches, searchesLoading } = useCatalogSearches(
        own?.search ?? "artists",
        own?.search ? terms : NO_TERMS,
    );

    return useMemo(
        () =>
            entries.map((entry, index) => {
                if (!own) return undefined;
                if (entry.entity_id) return entry.entity_id;
                if (terms[index] && searchesLoading) return undefined;
                const found = searches?.[index];
                const matched =
                    found && own.search === "artists"
                        ? found.artists.find((artist) =>
                              matchesByName(entry, { name: artist.name }),
                          )
                        : found?.albums.find((album) =>
                              matchesByName(entry, {
                                  name: album.title,
                                  artistName: album.artistName,
                              }),
                          );
                if (matched) return matched.catalogId ?? matched.id;
                const sample = tracksById.get(entry.sample_song_id);
                return sample ? own.sampleIdFor?.(sample) : undefined;
            }),
        [own, entries, terms, searches, searchesLoading, tracksById],
    );
}

const NO_TERMS: readonly (string | null)[] = [];

/** What a row's own resource adds: its picture, and who made it. */
type OwnResource = { artworkUrl?: string; creator?: string };

/**
 * A row's own resources by id, for one kind. Both lookups are always called,
 * and the one that is not this kind gets no ids, so it makes no request.
 */
function useOwnResources(
    kind: OwnSource["kind"] | undefined,
    ids: readonly (string | undefined)[],
): Map<string, OwnResource> {
    const present = useMemo(
        () => ids.filter((id): id is string => Boolean(id)),
        [ids],
    );
    const { collections } = useCollectionsInfo(
        kind === "album" ? "album" : "playlist",
        kind === "album" || kind === "playlist" ? present : NO_IDS,
    );
    const { artists } = useArtistsInfo(kind === "artist" ? present : NO_IDS);

    return useMemo(() => {
        const byId = new Map<string, OwnResource>();
        const add = (
            itemIds: (string | undefined)[],
            resource: OwnResource,
        ) => {
            for (const id of itemIds) if (id) byId.set(id, resource);
        };
        for (const item of collections) {
            add([item.id, item.catalogId, item.libraryId], {
                artworkUrl: usable(item.artworkUrl),
                creator: item.artistName || undefined,
            });
        }
        for (const item of artists) {
            add([item.id, item.catalogId, item.libraryId], {
                artworkUrl: usable(item.artworkUrl),
            });
        }
        return byId;
    }, [collections, artists]);
}

function usable(url?: string) {
    return url && isUsableArtworkUrl(url) ? url : undefined;
}

const NO_IDS: readonly string[] = [];
