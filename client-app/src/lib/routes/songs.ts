import { useMemo } from "react";
import { useAPIData, useAPIMutation, useAPIPostDataBatched } from "../api-actions";
import { Tag } from "@/lib/types";

// the backend caps a batch at 200 ids
const TAGS_ON_SONGS_BATCH_SIZE = 200;

export function useTagsOnSong(songId?: string) {
    const x = useAPIData<Tag[]>("/songs/tags", {
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
    const x = useAPIPostDataBatched<string, { song_ids: string[] }, Record<string, Tag[]>>(
        "/songs/tags/batch",
        normalizedIds,
        {
            batchSize: TAGS_ON_SONGS_BATCH_SIZE,
            toBody: (song_ids) => ({ song_ids }),
            merge: (responses) => Object.assign({}, ...responses),
        },
    );
    const tagsBySong = x.data ?? EMPTY_TAGS_BY_SONG;

    return {
        tagsBySong,
        tagsBySongLoading: x.isLoading,
        tagsBySongErr: x.error,
    };
}

const EMPTY_TAGS_BY_SONG: Record<string, Tag[]> = {};

type ApplyTagPayload = {
    song_id: string;
    tag_id: number;
};
export function useApplyTag() {
    const x = useAPIMutation<ApplyTagPayload, void>(
        "POST",
        "/songs/tags",
        ({ song_id }) => [
            { path: "/songs/tags", params: { song_id } },
            { path: "/songs/tags/batch" },
            { path: "/tags" },
        ],
    );
    return {
        applyTagErr: x.error,
        applyTagLoading: x.isMutating,
        resetApplyTag: x.reset,
        applyTag: x.trigger,
    };
}

type UnapplyTagPayload = ApplyTagPayload;
export function useUnapplyTag() {
    const x = useAPIMutation<UnapplyTagPayload, void>(
        "DELETE",
        "/songs/tags",
        ({ song_id }) => [
            { path: "/songs/tags", params: { song_id } },
            { path: "/songs/tags/batch" },
            { path: "/tags" },
        ],
    );
    return {
        unapplyTagErr: x.error,
        unapplyTagLoading: x.isMutating,
        resetUnpplyTag: x.reset,
        unapplyTag: x.trigger,
    };
}
