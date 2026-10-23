import type { MusicItem } from "@apple-musickit";
import { useEffect, useMemo, useRef, useState } from "react";

import type { QueryJSON } from "@/lib/query-json";
import {
    arrangeFieldJSON,
    isArranged,
    releaseDay,
    sectionsOf,
    type ArrangeFieldJSON,
    type ArrangedGroupJSON,
    type SongArrangement,
    type SongSection,
} from "@/lib/song-arrangement";

import { useAPIMutation, useAPIPostSnapshot } from "../api-actions";
import { storedTracks, type StoredSongRowJSON } from "../stored-tracks";

/**
 * Where an arranged list's songs come from. A query (Query results, and the
 * library as "In My Library") is run by the backend. A list only the phone
 * knows (a playlist, an album, a tag's songs) sends its ids.
 */
export type ArrangeSource =
    | {
          kind: "query";
          query: QueryJSON;
          considerDefaultTags: boolean;
          libraryOnly: boolean;
      }
    | { kind: "songs"; songIds: readonly string[] };

type ArrangedBody = {
    sort?: ArrangeFieldJSON;
    group?: ArrangeFieldJSON;
    time_zone?: string;
} & (
    | {
          query: QueryJSON;
          consider_default_tags: boolean;
          library_only?: true;
      }
    | { song_ids: readonly string[] }
);

type ArrangedResponse = {
    songs: { song_id: string; certain: boolean; row?: StoredSongRowJSON }[];
    capped: boolean;
    groups: ArrangedGroupJSON[] | null;
    missing_metadata: string[];
};

/** One song in an arranged list. `certain` is true for the user's own. */
export type ArrangedSong = { songId: string; certain: boolean };

/** Every song in a list, whatever the list says it is, as ids. */
export type TrackLookup = (
    songIds: readonly string[],
) => Promise<ReadonlyMap<string, MusicItem>>;

const NO_SONGS: ArrangedSong[] = [];
const NO_ROW_TRACKS: ReadonlyMap<string, MusicItem> = new Map();
const NO_IDS: string[] = [];
/** The most songs one `POST /songs/metadata/library` takes. */
const LIBRARY_METADATA_BATCH = 500;

/**
 * A song list sorted and grouped by the backend, fetched once and held for as
 * long as the caller stays mounted (`useAPIPostSnapshot`), so tagging or
 * playing a song never moves rows under the user. A new source or arrangement
 * fetches again.
 *
 * A query source is always fetched, arranged or not, since its order comes
 * from the backend either way. A list of ids is only fetched when arranged:
 * unarranged it keeps its own order, and the caller shows it as it is.
 *
 * Sorting reads `metadata_song_tags_applied`, and the backend stores any of the
 * list's songs missing from it before it sorts. A song Apple's catalog has no
 * entry for (an upload, or one Apple never matched) comes back in
 * `missing_metadata`; this sends what MusicKit knows about it through
 * `POST /songs/metadata/library`, found by `lookupTracks`, and fetches the
 * list once more, so it sorts by its title like any other. That happens once
 * per arrangement, whatever came of it.
 *
 * A sorted or grouped query's songs come with what the backend stores about
 * them (`rowTracks`), so the list can draw its rows without asking Apple.
 */
export function useArrangedSongs(
    source: ArrangeSource | null,
    arrangement: SongArrangement,
    lookupTracks: TrackLookup,
) {
    const arranged = isArranged(arrangement);
    const body = useMemo<ArrangedBody | null>(() => {
        if (!source) return null;
        if (source.kind === "songs" && !arranged) return null;
        const choices = {
            ...(arrangement.sort
                ? { sort: arrangeFieldJSON(arrangement.sort) }
                : {}),
            ...(arrangement.group
                ? {
                      group: arrangeFieldJSON(arrangement.group),
                      time_zone: deviceTimeZone(),
                  }
                : {}),
        };
        return source.kind === "query"
            ? {
                  query: source.query,
                  consider_default_tags: source.considerDefaultTags,
                  // left out when off, the same request as before the setting
                  ...(source.libraryOnly
                      ? { library_only: true as const }
                      : {}),
                  ...choices,
              }
            : { song_ids: source.songIds, ...choices };
    }, [arranged, arrangement.group, arrangement.sort, source]);
    const path =
        source?.kind === "songs" ? "/queries/arrange" : "/queries/results";

    const [revision, setRevision] = useState({ body, count: 0 });
    const currentRevision = revision.body === body ? revision.count : 0;
    const snapshot = useAPIPostSnapshot<ArrangedBody, ArrangedResponse>(
        path,
        body,
        currentRevision,
    );
    // the answer from before filling in what was missing, kept up while the
    // list is fetched again, so the rows do not blink out and back
    const [held, setHeld] = useState<{
        body: ArrangedBody;
        data: ArrangedResponse;
    } | null>(null);
    // set while rendering, React's way of keeping a value from an earlier render
    if (body && snapshot.data && held?.data !== snapshot.data) {
        setHeld({ body, data: snapshot.data });
    }
    const response = body
        ? (snapshot.data ?? (held?.body === body ? held.data : undefined))
        : undefined;

    const fillMissingMetadata = useFillMissingMetadata(lookupTracks);
    const filledFor = useRef<ArrangedBody | null>(null);
    useEffect(() => {
        const missing = response?.missing_metadata;
        if (!arranged || !body || !missing?.length) return;
        if (filledFor.current === body) return;
        filledFor.current = body;
        void (async () => {
            const stored = await fillMissingMetadata(missing);
            // only this body's list is worth fetching again
            if (stored > 0) {
                setRevision((current) => ({
                    body,
                    count: (current.body === body ? current.count : 0) + 1,
                }));
            }
        })();
    }, [arranged, body, fillMissingMetadata, response]);

    const songs = useMemo(
        () =>
            response
                ? response.songs.map((song) => ({
                      songId: song.song_id,
                      certain: song.certain,
                  }))
                : NO_SONGS,
        [response],
    );
    const songIds = useMemo(
        () => (response ? songs.map((song) => song.songId) : NO_IDS),
        [response, songs],
    );
    // what the backend stores about each song, so the rows draw without Apple
    const rowTracks = useMemo(
        () => (response ? storedTracks(response.songs) : NO_ROW_TRACKS),
        [response],
    );
    const groupField = arrangement.group?.field ?? null;
    const sections = useMemo<SongSection[] | null>(
        () =>
            response?.groups && groupField
                ? sectionsOf(songIds, response.groups, groupField)
                : null,
        [groupField, response, songIds],
    );

    return {
        /** False for a list of ids left unarranged, which nothing was fetched for. */
        active: body !== null,
        songs,
        songIds,
        /** The groups, when the arrangement groups. */
        sections,
        /**
         * Tracks made from the backend's stored rows, by song id. Only a sorted
         * or grouped query has them, and only for songs with a stored title.
         */
        rowTracks,
        capped: response?.capped ?? false,
        loading: body !== null && snapshot.isLoading && !response,
        // an empty request has nothing to fail, whatever the last one left
        error: body ? snapshot.error : undefined,
    };
}

/** The device's IANA zone, which a datetime group counts its days in. */
function deviceTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

type LibraryMetadataPayload = {
    songs: {
        song_id: string;
        title: string;
        artist_name?: string;
        album_name?: string;
        genre_names: string[];
        duration_ms?: number;
        release_date?: string;
    }[];
};

/**
 * Sends what MusicKit knows about `songIds` to `POST /songs/metadata/library`,
 * and returns how many songs the backend stored. Logs and gives up on a
 * failure, since the list is still usable without it.
 */
function useFillMissingMetadata(lookupTracks: TrackLookup) {
    const { trigger } = useAPIMutation<LibraryMetadataPayload, string[]>(
        "POST",
        "/songs/metadata/library",
        [{ path: "/songs/metadata-tags" }],
    );

    return useMemo(
        () => async (songIds: readonly string[]) => {
            try {
                const tracks = await lookupTracks(songIds);
                const songs = songIds.flatMap((songId) => {
                    const track = tracks.get(songId);
                    return track?.title
                        ? [libraryMetadataOf(songId, track)]
                        : [];
                });
                let stored = 0;
                for (
                    let start = 0;
                    start < songs.length;
                    start += LIBRARY_METADATA_BATCH
                ) {
                    const written = await trigger({
                        songs: songs.slice(
                            start,
                            start + LIBRARY_METADATA_BATCH,
                        ),
                    });
                    stored += written?.length ?? 0;
                }
                return stored;
            } catch (error) {
                console.error(
                    "Could not fill in metadata for sorted songs:",
                    error,
                );
                return 0;
            }
        },
        [lookupTracks, trigger],
    );
}

/** A track as `POST /songs/metadata/library` takes it, under the id the backend has. */
function libraryMetadataOf(songId: string, track: MusicItem) {
    return {
        song_id: songId,
        title: track.title,
        artist_name: track.artistName,
        album_name: track.albumName,
        genre_names: track.genres ?? [],
        duration_ms:
            track.songDuration != null
                ? Math.round(track.songDuration * 1000)
                : undefined,
        release_date: releaseDay(track.releaseDate),
    };
}
