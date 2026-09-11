import { useAPIData, useAPIMutation } from "../api-actions";
import { Tag } from "@/lib/types";

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
