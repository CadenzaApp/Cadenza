import { useAPIData, useAPIFetch, useAPIMutation } from "../swr-utils";
import { Tag } from "@/lib/types";

type TagsResponse = {
    Single?: {
        tag: Tag;
        song_ids: string[];
    };
    Many?: { tag: Tag; count: number }[];
};
export function useTags(tagId?: number) {
    return useAPIData<TagsResponse>("/tags", {
        tag_id: tagId,
    });
}

type NewTagPayload = {
    name: string;
    color: string;
};
export function useCreateTag() {
    return useAPIMutation<NewTagPayload, number>("POST", "/tags", [
        "/tags/songs",
        "/songs/tags",
    ]);
}

export function useDeleteTag() {
    return useAPIMutation<{ tag_id: number }, void>("DELETE", "/tags", [
        "/tags/songs",
        "/songs/tags",
    ]);
}

type SuggestTagsParams = {
    song_desc: string;
};
export function useSuggestTags(params: SuggestTagsParams) {
    return useAPIFetch<SuggestTagsParams, string[]>("/tags/suggest", params);
}
