import { type LibraryResult, MusicKit, type MusicItem } from "@apple-musickit";
import { useEffect } from "react";

import { useAccount } from "./account";
import { useAppleMusic } from "./apple-music-auth";
import {
    type SongIdAndDesc,
    useGetUntaggedSongs,
    useSetDefaultTags,
} from "./routes/songs";

// MusicKit returns at most 100 library songs a page, which is also under the
// backend's 200 song cap per request
const LIBRARY_PAGE_SIZE = 100;

type GetUntaggedSongs = ReturnType<
    typeof useGetUntaggedSongs
>["getUntaggedSongs"];
type SetDefaultTags = ReturnType<typeof useSetDefaultTags>["setDefaultTags"];

/**
 * Gives every song in the user's Apple Music library that has no tags a set of
 * generated default tags. Starts once there is an account and a connected
 * Apple Music session, and starts over if either changes.
 */
export function useSetDefaultTagsOnStartup() {
    const { account } = useAccount();
    const { isConnected, sessionRevision } = useAppleMusic();
    const { getUntaggedSongs } = useGetUntaggedSongs();
    const { setDefaultTags } = useSetDefaultTags();
    const accountId = account?.id;

    // Not SWR on purpose: this is a one-off background job that reads only to
    // decide what to write, and nothing renders its result.
    useEffect(() => {
        // needs a signed-in account and an Apple Music library to read
        if (!accountId || !isConnected || !MusicKit.isAvailable()) return;

        // run the job in the background. failed pages are handled inside, so
        // anything caught here stopped the whole job
        let cancelled = false;
        setDefaultTagsOnLibrary(
            getUntaggedSongs,
            setDefaultTags,
            () => cancelled,
        ).catch((error) => {
            console.error("Setting default tags on library songs failed:", error);
        });

        // a new account or session stops this run before its next page
        return () => {
            cancelled = true;
        };
    }, [
        accountId,
        isConnected,
        sessionRevision,
        getUntaggedSongs,
        setDefaultTags,
    ]);
}

/**
 * Pages through the library. For each page, asks the backend which songs have
 * no tags, then sends those songs' descriptions off to get default tags.
 */
async function setDefaultTagsOnLibrary(
    getUntaggedSongs: GetUntaggedSongs,
    setDefaultTags: SetDefaultTags,
    isCancelled: () => boolean,
) {
    let offset: number | undefined = 0;

    while (offset !== undefined && !isCancelled()) {
        // read the next page of library songs
        const page: LibraryResult = await MusicKit.getLibrarySongs({
            limit: LIBRARY_PAGE_SIZE,
            offset,
        });

        // tags key on the catalog id when there is one, same as everywhere else
        const songsById = new Map(
            page.items.map((song) => [song.catalogId ?? song.id, song] as const),
        );

        // ask the backend which of this page's songs have no tags at all
        const untaggedIds =
            songsById.size > 0
                ? await getUntaggedSongs({ song_ids: [...songsById.keys()] })
                : [];

        // describe each untagged song with the metadata MusicKit already returned
        const untaggedSongs: SongIdAndDesc[] = untaggedIds.flatMap((songId) => {
            const song = songsById.get(songId);
            return song ? [{ song_id: songId, desc: getSongDescription(song) }] : [];
        });

        // generate and store their default tags. a failed page is logged and
        // skipped so the rest of the library still gets tags
        if (untaggedSongs.length > 0 && !isCancelled()) {
            try {
                await setDefaultTags(untaggedSongs);
            } catch (error) {
                console.error(
                    "Setting default tags on a library page failed:",
                    error,
                );
            }
        }

        // move on to the next page, if there is one
        offset =
            page.hasNextPage && page.items.length > 0
                ? page.nextOffset
                : undefined;
    }
}

function getSongDescription(song: MusicItem) {
    return song.artistName ? `${song.title} by ${song.artistName}` : song.title;
}
