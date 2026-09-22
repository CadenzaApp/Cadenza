import { MusicKit } from "@apple-musickit";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { useTasks } from "@/components/custom/tasks";

import { useAccount } from "./account";
import { invalidateAPIData } from "./api-actions";
import { useAppleMusic } from "./apple-music-auth";
import {
    createInitializedSongsStore,
    openInitializedSongsDb,
} from "./initialized-songs-db";
import { useEditUserSongs } from "./routes/songs";
import { LOG_TAG, syncLibrary } from "./song-init-job";

const SYNC_LABEL = "Syncing with Apple Music";
const SYNC_FAILURE = "Could not sync with Apple Music";

/**
 * Keeps the backend's copy of the user's library in step with Apple Music.
 * Starts once there is an account and a connected Apple Music session, and
 * starts over if either changes.
 *
 * It shows one task while it runs. The work behind it is a walk of Apple Music
 * plus a `PATCH /songs` per batch of changes; `song-init-job.ts` has the shape
 * of the run and `initialized-songs-db.ts` the local record it diffs against.
 *
 * Default tags are not its job any more. The backend generates them the first
 * time something reads them.
 *
 * It is mounted at the root, under the account and Apple Music providers the
 * job needs and under `TasksProvider`.
 */
export function SongInitProvider({ children }: { children: ReactNode }) {
    const { account } = useAccount();
    const { isConnected, sessionRevision } = useAppleMusic();
    const { editUserSongs } = useEditUserSongs();
    const { addTask, endTaskSuccess, endTaskFail } = useTasks();
    const accountId = account?.id;

    // Not SWR on purpose: this is a one-off background job that reads only to
    // decide what to write. Nothing it finds is rendered from here.
    useEffect(() => {
        // needs a signed-in account and an Apple Music library to read
        if (!accountId || !isConnected || !MusicKit.isAvailable()) return;

        let cancelled = false;
        let taskId: number | null = addTask(SYNC_LABEL);

        const endTask = (failure?: string) => {
            if (taskId === null) return;
            if (failure === undefined) endTaskSuccess(taskId);
            else endTaskFail(taskId, failure);
            taskId = null;
        };

        const run = async () => {
            const db = await openInitializedSongsDb();
            // the file is per device and the library is per account, so the
            // store is bound to the account this run is for
            const store = createInitializedSongsStore(db, accountId);

            return syncLibrary({
                getLibrarySongs: (options) => MusicKit.getLibrarySongs(options),
                getUserPlaylists: (options) =>
                    MusicKit.getUserPlaylists(options),
                getPlaylistSongs: (playlistId, options) =>
                    MusicKit.getPlaylistSongs(playlistId, options),
                store,
                editUserSongs: (payload) => editUserSongs(payload),
                now: () => Date.now(),
                isCancelled: () => cancelled,
            });
        };

        run()
            .then((result) => {
                if (cancelled) return;
                // what a query matches follows the library, so anything open
                // is stale. once per run, not once per batch
                if (result.added > 0 || result.removed > 0) {
                    invalidateAPIData([{ path: "/queries/results" }]);
                }
                endTask();
            })
            .catch((error) => {
                console.error(`${LOG_TAG} the run failed:`, error);
                if (cancelled) return;
                endTask(SYNC_FAILURE);
            });

        // a new account or session stops this run before its next request.
        // what it already sent stays sent, and the store already records it
        return () => {
            cancelled = true;
            endTask("Library sync stopped");
        };
    }, [
        accountId,
        isConnected,
        sessionRevision,
        editUserSongs,
        addTask,
        endTaskSuccess,
        endTaskFail,
    ]);

    return children;
}
