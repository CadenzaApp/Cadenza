import { useMemo } from "react";
import { useAPIData, useAPIMutation, useAPIPostDataPages } from "../api-actions";
import { Tag } from "@/lib/types";

const TAGS_ON_SONGS_BATCH_SIZE = 25;

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
    const batches = useMemo(
        () =>
            chunk(normalizedIds, TAGS_ON_SONGS_BATCH_SIZE).map((song_ids) => ({
                song_ids,
            })),
        [normalizedIds],
    );
    const x = useAPIPostDataPages<{ song_ids: string[] }, Record<string, Tag[]>>(
        "/songs/tags/batch",
        batches,
    );
    const tagsBySong = useMemo<Record<string, Tag[]>>(
        () => Object.assign({}, ...(x.data ?? [])),
        [x.data],
    );

    return {
        tagsBySong,
        tagsBySongLoading: x.isLoading,
        tagsBySongErr: x.error,
    };
}

function chunk<T>(values: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

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
