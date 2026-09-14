import { MusicKit } from "@apple-musickit";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useAccount } from "./account";
import { invalidateAPIData } from "./api-actions";
import { useAppleMusic } from "./apple-music-auth";
import { useGetUntaggedSongs, useSetDefaultTags } from "./routes/songs";
import { initializeSongs } from "./song-init-job";

/** How many uninitialized songs the running job has found and not finished with. */
const UninitializedSongCountContext = createContext(0);

/**
 * Initializes the songs in the user's library and library playlists, so
 * queries reach them, and shares how many are left. Starts once there is an
 * account and a connected Apple Music session, and starts over if either
 * changes.
 *
 * It is mounted at the root, under the account and Apple Music providers the
 * job needs.
 */
export function SongInitProvider({ children }: { children: ReactNode }) {
    const { account } = useAccount();
    const { isConnected, sessionRevision } = useAppleMusic();
    const { getUntaggedSongs } = useGetUntaggedSongs();
    const { setDefaultTags } = useSetDefaultTags();
    const [uninitializedSongCount, setUninitializedSongCount] = useState(0);
    const accountId = account?.id;

    // Not SWR on purpose: this is a one-off background job that reads only to
    // decide what to write. The count is the only thing that renders.
    useEffect(() => {
        // needs a signed-in account and an Apple Music library to read
        if (!accountId || !isConnected || !MusicKit.isAvailable()) return;

        // run the job in the background. failures inside it are logged and
        // skipped, so anything caught here stopped the whole job
        let cancelled = false;
        initializeSongs({
            getLibrarySongs: (options) => MusicKit.getLibrarySongs(options),
            getUserPlaylists: (options) => MusicKit.getUserPlaylists(options),
            getPlaylistSongs: (playlistId, options) =>
                MusicKit.getPlaylistSongs(playlistId, options),
            getUntaggedSongs: (body) => getUntaggedSongs(body),
            setDefaultTags: (songs) => setDefaultTags(songs),
            // initializing copies default tags into the user's own tags, so the
            // tag list and its counts change. song tag reads initialize their
            // own songs, so they are already current
            onSongsInitialized: () => invalidateAPIData([{ path: "/tags" }]),
            onUninitializedCountChange: (count) => {
                if (!cancelled) setUninitializedSongCount(count);
            },
            isCancelled: () => cancelled,
        })
            .catch((error) => {
                console.error("Initializing songs failed:", error);
            })
            .finally(() => {
                // the job is over, so nothing it found is still in progress
                if (!cancelled) setUninitializedSongCount(0);
            });

        // a new account or session stops this run before its next request
        return () => {
            cancelled = true;
            setUninitializedSongCount(0);
        };
    }, [
        accountId,
        isConnected,
        sessionRevision,
        getUntaggedSongs,
        setDefaultTags,
    ]);

    return (
        <UninitializedSongCountContext.Provider value={uninitializedSongCount}>
            {children}
        </UninitializedSongCountContext.Provider>
    );
}

/**
 * How many songs the song init job has found uninitialized and not finished
 * with yet. 0 when no job is running.
 */
export function useUninitializedSongCount() {
    return useContext(UninitializedSongCountContext);
}
