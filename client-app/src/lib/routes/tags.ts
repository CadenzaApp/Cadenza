import { useAPIData, useAPIFetch, useAPIMutation } from "../swr-utils";
import { Tag } from "@/lib/types";

type TagsResponse = {
    One?: {
        tag: Tag;
        song_ids: string[];
    };
    All?: { tag: Tag; count: number }[];
};
export function useTags() {
    const x = useAPIData<TagsResponse>("/tags");

    return {
        tagsWithMeta: x.data?.All,
        tagsLoading: x.isLoading,
        tagsErr: x.error,
    };
}

export function useTag(tagId?: number) {
    const x = useAPIData<TagsResponse>("/tags", {
        tag_id: tagId,
    });

    return {
        tag: x.data?.One?.tag,
        songIds: x.data?.One?.song_ids,
        tagsLoading: x.isLoading,
        tagsErr: x.error,
    };
}

type NewTagPayload = {
    name: string;
    color: string;
};
export function useCreateTag() {
    const x = useAPIMutation<NewTagPayload, number>("POST", "/tags");
    return {
        createTagErr: x.error,
        createTagLoading: x.isMutating,
        resetCreateTag: x.reset,
        createTag: x.trigger,
    };
}

export function useDeleteTag() {
    const x = useAPIMutation<{ tag_id: number }, void>("DELETE", "/tags", [
        { path: "/songs/tags", params: "*" },
    ]);
    return {
        deleteTagErr: x.error,
        deleteTagLoading: x.isMutating,
        resetDeleteTag: x.reset,
        deleteTag: x.trigger,
    };
}

type SuggestTagsParams = {
    song_desc: string;
};
export function useSuggestTags() {
    const x = useAPIFetch<SuggestTagsParams, string[]>("/tags/suggest");
    return {
        suggestedTagNames: x.data,
        suggestTagsLoading: x.isMutating,
        suggestTagsErr: x.error,
        resetSuggestTags: x.reset,
        suggestTags: x.trigger,
    };
}
