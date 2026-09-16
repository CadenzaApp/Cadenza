import { useMemo } from "react";
import {
    useAPIData,
    useAPIMutation,
    useAPIPostDataBatched,
} from "../api-actions";
import { AppliedTag } from "@/lib/types";

// the backend caps a batch at 200 ids
const TAGS_ON_SONGS_BATCH_SIZE = 200;

export function useTagsOnSong(songId?: string) {
    const x = useAPIData<AppliedTag[]>("/songs/tags", {
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
    >("/songs/tags/batch", normalizedIds, {
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
        "/songs/tags",
        ({ song_id }) => [
            { path: "/songs/tags", params: { song_id } },
            { path: "/songs/tags/batch" },
            { path: "/tags" },
            { path: "/queries/results" },
            { path: "/queries/advanced/results" },
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
        "/songs/tags",
        ({ song_id }) => [
            { path: "/songs/tags", params: { song_id } },
            { path: "/songs/tags/batch" },
            { path: "/tags" },
            { path: "/queries/results" },
            { path: "/queries/advanced/results" },
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
        "/songs/tags",
        ({ song_id }) => [
            { path: "/songs/tags", params: { song_id } },
            { path: "/songs/tags/batch" },
            { path: "/tags" },
            { path: "/queries/results" },
            { path: "/queries/advanced/results" },
        ],
    );
    return {
        unapplyTagErr: x.error,
        unapplyTagLoading: x.isMutating,
        resetUnpplyTag: x.reset,
        unapplyTag: x.trigger,
    };
}
