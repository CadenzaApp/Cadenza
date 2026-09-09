import { useAPIData, useAPIFetch, useAPIMutation } from "../api-actions";
import { Tag, TagMetadata } from "@/lib/types";

type UserTagsResponse = {
    All: { tags: Tag[]; metadata: Record<number, TagMetadata> };
};
export function useUserTags() {
    const x = useAPIData<UserTagsResponse>("/tags");

    return {
        userTags: x.data?.All.tags,
        userTagsMeta: x.data?.All.metadata,
        userTagsLoading: x.isLoading,
        userTagsErr: x.error,
    };
}

type OneTagResponse = {
    One: {
        tag: Tag;
        song_ids: string[];
    };
}
export function useTag(tagId?: number) {
    const x = useAPIData<OneTagResponse>("/tags", {
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
    const x = useAPIMutation<NewTagPayload, number>("POST", "/tags", [
        { path: "/songs/tags" },
        { path: "/songs/tags/batch" },
        { path: "/tags" },
    ]);
    return {
        createTagErr: x.error,
        createTagLoading: x.isMutating,
        resetCreateTag: x.reset,
        createTag: x.trigger,
    };
}

export function useDeleteTag() {
    const x = useAPIMutation<{ tag_id: number }, void>("DELETE", "/tags", [
        { path: "/songs/tags" },
        { path: "/songs/tags/batch" },
        { path: "/tags" },
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
    requested_tag_count: number;
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
