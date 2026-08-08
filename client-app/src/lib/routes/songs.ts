import { useAPIData, useAPIMutation } from "../swr-utils";
import { Tag } from "@/lib/types";



type UseTagsOnSongData = {
    global: Tag[];
    local: Tag[];
};
export function useTagsOnSong(songId: string) {
    return useAPIData<UseTagsOnSongData>("/songs/tags", {
        song_id: songId,
    });
}

type ApplyTagPayload = {
    song_id: string;
    tag_id: number;
};
export function useApplyTag() {
    return useAPIMutation<ApplyTagPayload, void>("POST", "/songs/tags");
}

type UnapplyTagPayload = ApplyTagPayload;
export function useUnapplyTag() {
    return useAPIMutation<UnapplyTagPayload, void>(
        "DELETE",
        "/songs/tags",
    );
}
