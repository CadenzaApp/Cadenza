import { useAPIData, useAPIMutation } from "../api-actions";
import { AppliedTag } from "@/lib/types";

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
            { path: "/tags" },
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
