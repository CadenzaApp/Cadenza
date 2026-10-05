import { useMemo } from "react";
import {
    invalidateAPIData,
    useAPIData,
    useAPIMutation,
    useAPIPostDataBatched,
} from "../api-actions";
import { AppliedTag, Tag } from "@/lib/types";

// Stable 25-song read chunks match MusicKit paging, so a newly appended page reuses every
// completed earlier chunk. The backend allows up to 200 ids per request.
const TAGS_ON_SONGS_BATCH_SIZE = 25;
const TAG_EDITS_MAX_SONGS_PER_BATCH = 200;
const TAG_EDITS_PER_BATCH = 4_000;
const TAG_EDIT_CONCURRENCY = 3;

export function useTagsOnSong(songId?: string, enabled = true) {
    const x = useAPIData<AppliedTag[]>(
        "/songs/local-tags",
        {
            song_id: songId,
        },
        { enabled },
    );

    return {
        tagsOnSong: x.data,
        tagsOnSongLoading: x.isLoading,
        tagsOnSongErr: x.error,
    };
}

/** Tags for many songs at once, so a list screen makes one request per batch instead of one per row. */
export function useTagsOnSongs(songIds: readonly string[]) {
    const normalizedIds = useMemo(
        () => [...new Set(songIds.filter(Boolean))],
        [songIds],
    );
    const x = useAPIPostDataBatched<
        string,
        { song_ids: string[] },
        Record<string, AppliedTag[]>
    >("/songs/local-tags/batch", normalizedIds, {
        batchSize: TAGS_ON_SONGS_BATCH_SIZE,
        toBody: (song_ids) => ({ song_ids }),
        merge: (responses) => Object.assign({}, ...responses),
    });
    const tagsBySong = x.data ?? EMPTY_TAGS_BY_SONG;

    return {
        tagsBySong,
        tagsBySongLoading: x.isLoading,
        tagsBySongErr: x.error,
    };
}

const EMPTY_TAGS_BY_SONG: Record<string, AppliedTag[]> = {};

type ApplyTagPayload = {
    song_id: string;
    tag_id: number;
    /** Only meaningful for attribute tags; omit to apply without a value. */
    value?: string | null;
};
export function useApplyTag() {
    const x = useAPIMutation<ApplyTagPayload, void>(
        "POST",
        "/songs/local-tags",
        ({ song_id, tag_id }) => [
            { path: "/songs/local-tags/batch", item: song_id },
            { path: "/tags", exactParams: true },
            { path: "/tags", params: { tag_id }, exactParams: true },
            { path: "/queries/results" },
        ],
        { invalidation: "background" },
    );
    return {
        applyTagErr: x.error,
        applyTagLoading: x.isMutating,
        resetApplyTag: x.reset,
        applyTag: x.trigger,
    };
}

type SetTagValuePayload = {
    song_id: string;
    tag_id: number;
    /** null clears the value while leaving the tag applied. */
    value: string | null;
};
export function useSetTagValue() {
    const x = useAPIMutation<SetTagValuePayload, void>(
        "PATCH",
        "/songs/local-tags",
        ({ song_id, tag_id }) => [
            { path: "/songs/local-tags", params: { song_id } },
            { path: "/songs/local-tags/batch", item: song_id },
            { path: "/tags", exactParams: true },
            { path: "/tags", params: { tag_id }, exactParams: true },
            { path: "/queries/results" },
        ],
        { invalidation: "background" },
    );
    return {
        setTagValueErr: x.error,
        setTagValueLoading: x.isMutating,
        resetSetTagValue: x.reset,
        setTagValue: x.trigger,
    };
}

type UnapplyTagPayload = {
    song_id: string;
    tag_id: number;
};
export function useUnapplyTag() {
    const x = useAPIMutation<UnapplyTagPayload, void>(
        "DELETE",
        "/songs/local-tags",
        ({ song_id, tag_id }) => [
            { path: "/songs/local-tags/batch", item: song_id },
            { path: "/tags", exactParams: true },
            { path: "/tags", params: { tag_id }, exactParams: true },
            { path: "/queries/results" },
        ],
        { invalidation: "background" },
    );
    return {
        unapplyTagErr: x.error,
        unapplyTagLoading: x.isMutating,
        resetUnpplyTag: x.reset,
        unapplyTag: x.trigger,
    };
}

export type EditTagsOnSongsPayload = {
    song_ids: string[];
    tag_ids: number[];
};

const BATCH_TAG_INVALIDATIONS = [
    { path: "/songs/local-tags" },
    { path: "/songs/local-tags/batch" },
    { path: "/songs/default-tags" },
    { path: "/songs/default-tags/batch" },
    { path: "/tags" },
    { path: "/queries/results" },
];

/** Applies each tag to each song, splitting requests at the backend's caps. */
export function useApplyTagsToSongs() {
    const mutation = useAPIMutation<EditTagsOnSongsPayload, void>(
        "PATCH",
        "/songs/local-tags/batch",
        [],
        { invalidation: "none" },
    );

    return {
        applyTagsToSongsLoading: mutation.isMutating,
        applyTagsToSongsErr: mutation.error,
        applyTagsToSongs: (payload: EditTagsOnSongsPayload) =>
            editTagsInBatches(mutation.trigger, payload),
    };
}

/** Removes each tag from each song, splitting requests at the backend's caps. */
export function useRemoveTagsFromSongs() {
    const mutation = useAPIMutation<EditTagsOnSongsPayload, void>(
        "DELETE",
        "/songs/local-tags/batch",
        [],
        { invalidation: "none" },
    );

    return {
        removeTagsFromSongsLoading: mutation.isMutating,
        removeTagsFromSongsErr: mutation.error,
        removeTagsFromSongs: (payload: EditTagsOnSongsPayload) =>
            editTagsInBatches(mutation.trigger, payload),
    };
}

async function editTagsInBatches(
    trigger: (payload: EditTagsOnSongsPayload) => Promise<void>,
    payload: EditTagsOnSongsPayload,
) {
    const songIds = [...new Set(payload.song_ids.filter(Boolean))];
    const tagIds = [...new Set(payload.tag_ids)];
    const batches: EditTagsOnSongsPayload[] = [];

    for (
        let tagOffset = 0;
        tagOffset < tagIds.length;
        tagOffset += TAG_EDITS_PER_BATCH
    ) {
        const tagBatch = tagIds.slice(
            tagOffset,
            tagOffset + TAG_EDITS_PER_BATCH,
        );
        const songBatchSize = Math.min(
            TAG_EDITS_MAX_SONGS_PER_BATCH,
            Math.max(1, Math.floor(TAG_EDITS_PER_BATCH / tagBatch.length)),
        );
        for (
            let songOffset = 0;
            songOffset < songIds.length;
            songOffset += songBatchSize
        ) {
            batches.push({
                song_ids: songIds.slice(songOffset, songOffset + songBatchSize),
                tag_ids: tagBatch,
            });
        }
    }

    let nextBatch = 0;
    try {
        const workers = Array.from(
            { length: Math.min(TAG_EDIT_CONCURRENCY, batches.length) },
            async () => {
                while (nextBatch < batches.length) {
                    const batch = batches[nextBatch++];
                    await trigger(batch);
                }
            },
        );
        const results = await Promise.allSettled(workers);
        const failure = results.find(
            (result): result is PromiseRejectedResult =>
                result.status === "rejected",
        );
        if (failure) throw failure.reason;
    } finally {
        // A large edit can require several transport-sized requests. Refresh
        // once after all workers settle, including partial failure, and do not
        // make cache freshness hold the action buttons open.
        if (batches.length > 0) {
            void invalidateAPIData(BATCH_TAG_INVALIDATIONS).catch((error) =>
                console.error("Tag edit cache refresh failed", error),
            );
        }
    }
}

type RemoveDefaultTagPayload = {
    song_id: string;
    tag_id: number;
};
/**
 * Removes one of the song's suggested tags for this user. The default tag stays
 * on the song for everyone else, so this only changes what the default tag reads
 * return here, plus query results that count suggested tags. It also counts
 * against that name, which makes it harder to become a default tag elsewhere.
 */
export function useRemoveDefaultTag() {
    const x = useAPIMutation<RemoveDefaultTagPayload, void>(
        "DELETE",
        "/songs/default-tags",
        ({ song_id }) => [
            { path: "/songs/default-tags", params: { song_id } },
            { path: "/songs/default-tags/batch", item: song_id },
            { path: "/queries/results" },
        ],
    );
    return {
        removeDefaultTagErr: x.error,
        removeDefaultTagLoading: x.isMutating,
        resetRemoveDefaultTag: x.reset,
        removeDefaultTag: x.trigger,
    };
}

/** Returns the shared default tags on one song, minus the ones this user removed. */
export function useDefaultTagsOnSong(songId?: string, enabled = true) {
    const x = useAPIData<Tag[]>(
        "/songs/default-tags",
        {
            song_id: songId,
        },
        { enabled },
    );

    return {
        defaultTagsOnSong: x.data,
        defaultTagsOnSongLoading: x.isLoading,
        defaultTagsOnSongErr: x.error,
    };
}

/** Default tags for many songs at once, batched the same way as `useTagsOnSongs`. */
export function useDefaultTagsOnSongs(songIds: readonly string[]) {
    const normalizedIds = useMemo(
        () => [...new Set(songIds.filter(Boolean))],
        [songIds],
    );
    const x = useAPIPostDataBatched<
        string,
        { song_ids: string[] },
        Record<string, Tag[]>
    >("/songs/default-tags/batch", normalizedIds, {
        batchSize: TAGS_ON_SONGS_BATCH_SIZE,
        toBody: (song_ids) => ({ song_ids }),
        merge: (responses) => Object.assign({}, ...responses),
    });
    const defaultTagsBySong = x.data ?? EMPTY_DEFAULT_TAGS_BY_SONG;

    return {
        defaultTagsBySong,
        defaultTagsBySongLoading: x.isLoading,
        defaultTagsBySongErr: x.error,
    };
}

const EMPTY_DEFAULT_TAGS_BY_SONG: Record<string, Tag[]> = {};

/**
 * This user's activity tags on one song, with values, in display order. A song
 * never played still gets every tag: My Plays is "0" and the dates are null.
 */
export function useActivityTagsOnSong(songId?: string) {
    const x = useAPIData<AppliedTag[]>("/songs/activity-tags", {
        song_id: songId,
    });

    return {
        activityTagsOnSong: x.data,
        activityTagsOnSongLoading: x.isLoading,
        activityTagsOnSongErr: x.error,
    };
}

/** Activity tags for many songs at once, batched the same way as `useTagsOnSongs`. */
export function useActivityTagsOnSongs(songIds: readonly string[]) {
    const normalizedIds = useMemo(
        () => [...new Set(songIds.filter(Boolean))],
        [songIds],
    );
    const x = useAPIPostDataBatched<
        string,
        { song_ids: string[] },
        Record<string, AppliedTag[]>
    >("/songs/activity-tags/batch", normalizedIds, {
        batchSize: TAGS_ON_SONGS_BATCH_SIZE,
        toBody: (song_ids) => ({ song_ids }),
        merge: (responses) => Object.assign({}, ...responses),
    });
    const activityTagsBySong = x.data ?? EMPTY_TAGS_BY_SONG;

    return {
        activityTagsBySong,
        activityTagsBySongLoading: x.isLoading,
        activityTagsBySongErr: x.error,
    };
}

export type EditUserSongsPayload = {
    /** Song ids to put in the user's library. Ones already there are ignored. */
    add: string[];
    /** Song ids to take out of it. Ones not there are ignored. Tags are kept. */
    remove: string[];
};
/**
 * Adds songs to and removes songs from the signed in user's library, which is
 * what queries run over.
 *
 * The library sync job calls this many times in a row, so it invalidates
 * nothing on its own. `song-init.tsx` invalidates `/queries/results` once, after
 * the run, rather than revalidating every open query per batch.
 */
export function useEditUserSongs() {
    const x = useAPIMutation<EditUserSongsPayload, void>("PATCH", "/songs");
    return {
        editUserSongsErr: x.error,
        editUserSongsLoading: x.isMutating,
        editUserSongs: x.trigger,
    };
}
