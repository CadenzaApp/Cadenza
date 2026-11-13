import type { MusicItem } from "@apple-musickit";
import { useCallback } from "react";

import { useTrackLookup } from "@/lib/musickit-hooks";
import { usePlayAll } from "@/lib/play-all";

import { concatUnique, mapInOrder } from "./play-queue";

/** Lists whose songs are read at once when Play queues them. */
const READS_AT_ONCE = 3;
/**
 * The most songs Play queues across every list. A list can hold a thousand
 * songs from outside the library, and each of those costs a lookup.
 */
const MAX_QUEUED_SONGS = 500;

/**
 * Play and Shuffle for a list of song lists, like every saved query or shared
 * playlist on show. Reads each one's songs a few at a time, joins them in
 * order with each song once, keeps the first 500, and looks the tracks up.
 * `arrange` reorders the read lists before they are joined; left out, they
 * join as read.
 */
export function usePlayLists<Item, Song>({
    items,
    read,
    songIdOf,
    arrange,
}: {
    items: readonly Item[];
    read: (item: Item) => Promise<readonly Song[]>;
    songIdOf: (song: Song) => string;
    arrange?: (lists: readonly (readonly Song[])[]) => (readonly Song[])[];
}) {
    const lookupTracks = useTrackLookup();
    const resolveQueue = useCallback(async (): Promise<MusicItem[]> => {
        const lists = await mapInOrder(items, READS_AT_ONCE, read);
        const songIds = concatUnique(arrange ? arrange(lists) : lists, songIdOf)
            .slice(0, MAX_QUEUED_SONGS)
            .map(songIdOf);
        const found = await lookupTracks(songIds);
        return concatUnique(
            [songIds.flatMap((songId) => found.get(songId) ?? [])],
            (track) => track.id,
        );
    }, [arrange, items, lookupTracks, read, songIdOf]);
    return usePlayAll({ resolveQueue });
}
