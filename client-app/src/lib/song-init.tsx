import { MusicKit } from "@apple-musickit";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { useTasks } from "@/components/custom/tasks";

import { useAccount } from "./account";
import { useAppleMusic } from "./apple-music-auth";
import { useSetDefaultTags, useSongsWithoutDefaultTags } from "./routes/songs";
import { initializeSongs } from "./song-init-job";

/** The search: every Apple Music page, asked about and collected. */
const SYNC_LABEL = "Syncing with Apple Music";
const SYNC_FAILURE = "Could not sync with Apple Music";

/** Everything after it: generating the default tags. */
const SUGGEST_LABEL = "Building tag suggestions";
const SUGGEST_FAILURE = "Could not build tag suggestions";

/**
 * Generates missing default tags for songs in the user's library and library
 * playlists. Starts once there is an account and a connected Apple Music
 * session, and starts over if either changes.
 *
 * It shows the job's two passes as a task each: one while it searches Apple
 * Music, then one while it builds tags for what that turned up. A run that
 * finds nothing to tag never shows the second.
 *
 * It is mounted at the root, under the account and Apple Music providers the
 * job needs and under `TasksProvider`.
 */
export function SongInitProvider({ children }: { children: ReactNode }) {
    const { account } = useAccount();
    const { isConnected, sessionRevision } = useAppleMusic();
    const { getSongsWithoutDefaultTags } = useSongsWithoutDefaultTags();
    const { setDefaultTags } = useSetDefaultTags();
    const { addTask, endTaskSuccess, endTaskFail } = useTasks();
    const accountId = account?.id;

    // Not SWR on purpose: this is a one-off background job that reads only to
    // decide what to write. Nothing it finds is rendered from here.
    useEffect(() => {
        // needs a signed-in account and an Apple Music library to read
        if (!accountId || !isConnected || !MusicKit.isAvailable()) return;

        // run the job in the background. failures inside it are logged and
        // skipped, so anything caught here stopped the whole job
        let cancelled = false;
        let failed = false;

        // the task for the pass the job is in, and what it says if that pass
        // is the one that stops the job
        let task: { id: number; failure: string } | null = {
            id: addTask(SYNC_LABEL),
            failure: SYNC_FAILURE,
        };

        const endPass = () => {
            if (task === null) return;
            if (failed) endTaskFail(task.id, task.failure);
            else endTaskSuccess(task.id);
            task = null;
        };

        initializeSongs({
            getLibrarySongs: (options) => MusicKit.getLibrarySongs(options),
            getUserPlaylists: (options) => MusicKit.getUserPlaylists(options),
            getPlaylistSongs: (playlistId, options) =>
                MusicKit.getPlaylistSongs(playlistId, options),
            getSongsWithoutDefaultTags: (body) =>
                getSongsWithoutDefaultTags(body),
            setDefaultTags: (songs) => setDefaultTags(songs),
            // the search is over, so its task is too. what it found is what
            // the next pass works through, and none of it means no task
            onSearchComplete: (count) => {
                if (cancelled) return;
                endPass();
                if (count === 0) return;
                task = {
                    id: addTask(SUGGEST_LABEL),
                    failure: SUGGEST_FAILURE,
                };
            },
            isCancelled: () => cancelled,
        })
            .catch((error) => {
                failed = true;
                console.error("Initializing songs failed:", error);
            })
            .finally(() => {
                // the job is over, so the pass it stopped in shows how it went
                if (cancelled) return;
                endPass();
            });

        // a new account or session stops this run before its next request.
        // whichever pass was open did not finish
        return () => {
            cancelled = true;
            if (task !== null) endTaskFail(task.id, "Tagging stopped");
            task = null;
        };
    }, [
        accountId,
        isConnected,
        sessionRevision,
        getSongsWithoutDefaultTags,
        setDefaultTags,
        addTask,
        endTaskSuccess,
        endTaskFail,
    ]);

    return children;
}
