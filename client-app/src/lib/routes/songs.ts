import { useMemo } from "react";
import {
    useAPIData,
    useAPIMutation,
    useAPIPostDataBatched,
} from "../api-actions";
import { AppliedTag, Tag } from "@/lib/types";

// the backend caps a batch at 200 ids
const TAGS_ON_SONGS_BATCH_SIZE = 200;

export function useTagsOnSong(songId?: string) {
    const x = useAPIData<AppliedTag[]>("/songs/local-tags", {
        song_id: songId,
    });

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
        ({ song_id }) => [
            { path: "/songs/local-tags", params: { song_id } },
            { path: "/songs/local-tags/batch" },
            { path: "/songs/default-tags", params: { song_id } },
            { path: "/songs/default-tags/batch" },
            { path: "/tags" },
            { path: "/queries/results" },
        ],
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
        ({ song_id }) => [
            { path: "/songs/local-tags", params: { song_id } },
            { path: "/songs/local-tags/batch" },
            { path: "/tags" },
            { path: "/queries/results" },
        ],
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
        ({ song_id }) => [
            { path: "/songs/local-tags", params: { song_id } },
            { path: "/songs/local-tags/batch" },
            { path: "/tags" },
            { path: "/queries/results" },
        ],
    );
    return {
        unapplyTagErr: x.error,
        unapplyTagLoading: x.isMutating,
        resetUnpplyTag: x.reset,
        unapplyTag: x.trigger,
    };
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
            { path: "/songs/default-tags/batch" },
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
export function useDefaultTagsOnSong(songId?: string) {
    const x = useAPIData<Tag[]>("/songs/default-tags", {
        song_id: songId,
    });

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
