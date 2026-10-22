import { MusicKit } from "@apple-musickit";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { ReactNode } from "react";

import { useTasks } from "@/components/custom/tasks";

import { useAccount } from "./account";
import { invalidateAPIData } from "./api-actions";
import { ACTIVITY_TAG_READS } from "./routes/activity-tag-reads";
import { useAppleMusic } from "./apple-music-auth";
import {
    createInitializedSongsStore,
    openInitializedSongsDb,
} from "./initialized-songs-db";
import { loadLastSyncedAt, saveLastSyncedAt } from "./last-synced-store";
import { readAppleMusic } from "./musickit-hooks";
import { useEditUserSongs } from "./routes/songs";
import { LOG_TAG, syncLibrary } from "./song-init-job";

const SYNC_LABEL = "Syncing with Apple Music";
const SYNC_FAILURE = "Could not sync with Apple Music";

type AppleMusicSyncValue = {
    /**
     * Runs a sync now, or joins the one already running. Afterwards every
     * cached library read is refetched. Resolves when it is done; failures
     * land in `error` rather than throwing.
     */
    syncNow: () => Promise<void>;
    isSyncing: boolean;
    /** Epoch milliseconds of this device's last complete sync, or null. */
    lastSyncedAt: number | null;
    /** Why the last run failed, cleared when the next one starts. */
    error: string | null;
    /** False without an account, a connected session, or MusicKit. */
    canSync: boolean;
};

const AppleMusicSyncContext = createContext<AppleMusicSyncValue | null>(null);

export function useAppleMusicSync() {
    const value = useContext(AppleMusicSyncContext);
    if (!value) {
        throw new Error("useAppleMusicSync requires SongInitProvider.");
    }
    return value;
}

/** One run in flight. `cancel` stops it before its next request. */
type SyncRun = {
    cancelled: boolean;
    done: Promise<void>;
    cancel: () => void;
};

/**
 * Keeps the backend's copy of the user's library in step with Apple Music.
 * Runs on its own once there is an account and a connected Apple Music
 * session, and starts over if either changes. `useAppleMusicSync().syncNow`
 * runs the same job by hand.
 *
 * Only one run is ever in flight: a manual sync during an automatic one joins
 * it. Each run shows one task while it works. The work is a walk of Apple
 * Music plus a `PATCH /songs` per batch of changes; `song-init-job.ts` has the
 * shape of the run and `initialized-songs-db.ts` the local record it diffs
 * against.
 *
 * Default tags are not its job any more. The backend generates them the first
 * time something reads them.
 *
 * It is mounted at the root, under the account and Apple Music providers the
 * job needs and under `TasksProvider`.
 */
export function SongInitProvider({ children }: { children: ReactNode }) {
    const { account } = useAccount();
    const { isConnected, sessionRevision, refreshLibrary } = useAppleMusic();
    const { editUserSongs } = useEditUserSongs();
    const { addTask, endTaskSuccess, endTaskFail } = useTasks();
    const accountId = account?.id;

    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // keyed by account so a switch never shows the last account's stamp
    const [synced, setSynced] = useState<{
        accountId: string;
        at: number | null;
    } | null>(null);
    const lastSyncedAt =
        synced && synced.accountId === accountId ? synced.at : null;
    const currentRun = useRef<SyncRun | null>(null);

    const canSync = Boolean(accountId && isConnected && MusicKit.isAvailable());

    useEffect(() => {
        if (!accountId) return;
        let live = true;
        void (async () => {
            const at = await loadLastSyncedAt(accountId);
            if (live) setSynced({ accountId, at });
        })();
        return () => {
            live = false;
        };
    }, [accountId]);

    // Not SWR on purpose: this is a one-off background job that reads only to
    // decide what to write. Nothing it finds is rendered from here.
    const startRun = useCallback((): SyncRun | null => {
        if (!accountId || !canSync) return null;
        if (currentRun.current) return currentRun.current;

        let taskId: number | null = addTask(SYNC_LABEL);
        const endTask = (failure?: string) => {
            if (taskId === null) return;
            if (failure === undefined) endTaskSuccess(taskId);
            else endTaskFail(taskId, failure);
            taskId = null;
        };

        const run: SyncRun = {
            cancelled: false,
            done: Promise.resolve(),
            // ends the task now rather than when the run next checks
            cancel: () => {
                run.cancelled = true;
                endTask("Library sync stopped");
            },
        };
        currentRun.current = run;
        run.done = (async () => {
            setIsSyncing(true);
            setError(null);
            try {
                const db = await openInitializedSongsDb();
                // the file is per device and the library is per account, so
                // the store is bound to the account this run is for
                const store = createInitializedSongsStore(db, accountId);
                const result = await syncLibrary({
                    getLibrarySongs: (options) =>
                        readAppleMusic(() => MusicKit.getLibrarySongs(options)),
                    getUserPlaylists: (options) =>
                        readAppleMusic(() =>
                            MusicKit.getUserPlaylists(options),
                        ),
                    getPlaylistSongs: (playlistId, options) =>
                        readAppleMusic(() =>
                            MusicKit.getPlaylistSongs(playlistId, options),
                        ),
                    store,
                    editUserSongs: (payload) => editUserSongs(payload),
                    now: () => Date.now(),
                    isCancelled: () => run.cancelled,
                });
                if (run.cancelled) return;

                // what a query matches follows the library, and so does In My
                // Library, so anything open is stale. once per run, not once
                // per batch
                if (result.added > 0 || result.removed > 0) {
                    invalidateAPIData([
                        { path: "/queries/results" },
                        ...ACTIVITY_TAG_READS,
                    ]);
                }
                // a walk that missed a source did not see the whole library
                if (result.complete) {
                    const finishedAt = Date.now();
                    setSynced({ accountId, at: finishedAt });
                    void saveLastSyncedAt(accountId, finishedAt);
                }
                endTask();
            } catch (runError) {
                console.error(`${LOG_TAG} the run failed:`, runError);
                if (run.cancelled) return;
                setError(SYNC_FAILURE);
                endTask(SYNC_FAILURE);
            } finally {
                if (currentRun.current === run) {
                    currentRun.current = null;
                    setIsSyncing(false);
                }
            }
        })();

        return run;
    }, [
        accountId,
        canSync,
        editUserSongs,
        addTask,
        endTaskSuccess,
        endTaskFail,
    ]);

    // a new account or session stops the run before its next request. what it
    // already sent stays sent, and the store already records it
    useEffect(() => {
        const run = startRun();
        return () => {
            if (!run) return;
            run.cancel();
            if (currentRun.current === run) {
                currentRun.current = null;
                setIsSyncing(false);
            }
        };
        // sessionRevision restarts the run on a new Apple Music session
    }, [startRun, sessionRevision]);

    const syncNow = useCallback(async () => {
        const run = startRun();
        if (!run) return;
        await run.done;
        if (run.cancelled) return;
        // the run only writes the backend's copy. what the app shows comes
        // from Apple Music reads, which a manual sync should refetch too
        refreshLibrary();
    }, [startRun, refreshLibrary]);

    const value = useMemo<AppleMusicSyncValue>(
        () => ({ syncNow, isSyncing, lastSyncedAt, error, canSync }),
        [syncNow, isSyncing, lastSyncedAt, error, canSync],
    );

    return (
        <AppleMusicSyncContext.Provider value={value}>
            {children}
        </AppleMusicSyncContext.Provider>
    );
}
