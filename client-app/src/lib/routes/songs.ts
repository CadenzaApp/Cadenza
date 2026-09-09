import { useMemo } from "react";
import { useAPIData, useAPIMutation, useAPIPostDataPages } from "../swr-utils";
import { Tag } from "@/lib/types";

type UseTagsOnSongData = {
    global: Tag[];
    local: Tag[];
};
export function useTagsOnSong(songId?: string) {
    const x = useAPIData<UseTagsOnSongData>("/songs/tags", {
        song_id: songId,
    });

    return {
        tagsOnSong: x.data,
        tagsOnSongLoading: x.isLoading,
        tagsOnSongErr: x.error,
    };
}

export function useTagsOnSongs(songIds: readonly string[]) {
    const normalizedIds = useMemo(
        () => [...new Set(songIds.filter(Boolean))],
        [songIds],
    );
    const batches = useMemo(
        () => chunk(normalizedIds, 25).map((song_ids) => ({ song_ids })),
        [normalizedIds],
    );
    const x = useAPIPostDataPages<
        { song_ids: string[] },
        Record<string, UseTagsOnSongData>
    >("/songs/tags/batch", batches);
    const tagsBySong = useMemo<Record<string, UseTagsOnSongData>>(
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
            { path: "/songs/tags/batch", params: "*" },
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
            { path: "/songs/tags/batch", params: "*" },
        ],
    );
    return {
        unapplyTagErr: x.error,
        unapplyTagLoading: x.isMutating,
        resetUnpplyTag: x.reset,
        unapplyTag: x.trigger,
    };
}
