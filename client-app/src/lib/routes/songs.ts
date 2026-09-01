import { useAPIData, useAPIMutation } from "../swr-utils";
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
    }
}

type ApplyTagPayload = {
    song_id: string;
    tag_id: number;
};
export function useApplyTag() {
    const x = useAPIMutation<ApplyTagPayload, void>(
        "POST",
        "/songs/tags",
        ({ song_id }) => [{ path: "/songs/tags", params: { song_id } }],
    );
    return {
        applyTagErr: x.error,
        applyTagLoading: x.isMutating,
        resetApplyTag: x.reset,
        applyTag: x.trigger,
    }
}

type UnapplyTagPayload = ApplyTagPayload;
export function useUnapplyTag() {
    const x = useAPIMutation<UnapplyTagPayload, void>(
        "DELETE",
        "/songs/tags",
        ({ song_id }) => [{ path: "/songs/tags", params: { song_id } }],
    );
    return {
        unapplyTagErr: x.error,
        unapplyTagLoading: x.isMutating,
        resetUnpplyTag: x.reset,
        unapplyTag: x.trigger,
    }
}
