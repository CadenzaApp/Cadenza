import { MusicKit } from "@apple-musickit";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { useTasks } from "@/components/custom/tasks";

import { useAccount } from "./account";
import { invalidateAPIData } from "./api-actions";
import { useAppleMusic } from "./apple-music-auth";
import { useInitSongs, useSetDefaultTags } from "./routes/songs";
import { initializeSongs } from "./song-init-job";

/** The label the job's running task carries. */
const TASK_LABEL = "Generating tags";

/**
 * Initializes the songs in the user's library and library playlists, so
 * queries reach them. Starts once there is an account and a connected Apple
 * Music session, and starts over if either changes. It keeps one running task
 * from the first song that needs tags until the job ends.
 *
 * It is mounted at the root, under the account and Apple Music providers the
 * job needs and under `RunningTasksProvider`.
 */
export function SongInitProvider({ children }: { children: ReactNode }) {
    const { account } = useAccount();
    const { isConnected, sessionRevision } = useAppleMusic();
    const { initSongs } = useInitSongs();
    const { setDefaultTags } = useSetDefaultTags();
    // const { addTask, endTask } = useTasks();
    const accountId = account?.id;

    // Not SWR on purpose: this is a one-off background job that reads only to
    // decide what to write. Nothing it finds is rendered from here.
    useEffect(() => {
        // needs a signed-in account and an Apple Music library to read
        if (!accountId || !isConnected || !MusicKit.isAvailable()) return;

        // run the job in the background. failures inside it are logged and
        // skipped, so anything caught here stopped the whole job
        let cancelled = false;
        let taskId: number | null = null;
        let failed = false;

        // one task for the whole job, added as soon as the search turns up a
        // song to tag. a run that finds none never shows one
        const startTask = (count: number) => {
            if (cancelled || count === 0 || taskId !== null) return;
            // taskId = addTask(TASK_LABEL);
        };

        initializeSongs({
            getLibrarySongs: (options) => MusicKit.getLibrarySongs(options),
            getUserPlaylists: (options) => MusicKit.getUserPlaylists(options),
            getPlaylistSongs: (playlistId, options) =>
                MusicKit.getPlaylistSongs(playlistId, options),
            initSongs: (body) => initSongs(body),
            setDefaultTags: (songs) => setDefaultTags(songs),
            // initializing copies default tags into the user's own tags, so the
            // tag list and its counts change. song tag reads initialize their
            // own songs, so they are already current
            onSongsInitialized: () => invalidateAPIData([{ path: "/tags" }]),
            onUninitializedCountChange: startTask,
            isCancelled: () => cancelled,
        })
            .catch((error) => {
                failed = true;
                console.error("Initializing songs failed:", error);
            })
            .finally(() => {
                // the job is over, so the task shows how it went and goes
                if (cancelled || taskId === null) return;
                // endTask(taskId, failed ? "fail" : "success");
                taskId = null;
            });

        // a new account or session stops this run before its next request.
        // the tagging did not finish, so the task ends as a failure
        return () => {
            cancelled = true;
            // if (taskId !== null) endTask(taskId, "fail");
            taskId = null;
        };
    }, [
        accountId,
        isConnected,
        sessionRevision,
        initSongs,
        setDefaultTags,
        // addTask,
        // endTask,
    ]);

    return children;
}
