import { useAPIData, useAPIFetch, useAPIMutation } from "../api-actions";
import {
    Tag,
    TagMetadata,
    TagScoreDeltas,
    TagScores,
    TagType,
    TopTagScores,
} from "@/lib/types";

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
};
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
    type: TagType;
};
export function useCreateTag() {
    const x = useAPIMutation<NewTagPayload, number>("POST", "/tags", [
        { path: "/songs/local-tags" },
        { path: "/songs/local-tags/batch" },
        { path: "/tags" },
        // a new tag can turn a top tag local and change its color
        { path: "/tags/scores" },
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
        { path: "/songs/local-tags" },
        { path: "/songs/local-tags/batch" },
        { path: "/tags" },
        // a deleted tag can drop out of the top tags or fall back to global
        { path: "/tags/scores" },
    ]);
    return {
        deleteTagErr: x.error,
        deleteTagLoading: x.isMutating,
        resetDeleteTag: x.reset,
        deleteTag: x.trigger,
    };
}

/**
 * Up to five shared default tags whose names match `search`, most used first. A
 * blank search still returns five, so the shelf always has something in it.
 *
 * Every keystroke is a new cache key, so the previous results stay up while the
 * next ones load rather than emptying the shelf.
 */
export function useDefaultTags(search: string) {
    const x = useAPIData<Tag[]>(
        "/tags/default-tags",
        { search },
        { keepPreviousData: true },
    );

    return {
        defaultTags: x.data,
        defaultTagsLoading: x.isLoading,
        defaultTagsErr: x.error,
    };
}

type SuggestTagsParams = {
    song_desc: string;
    requested_tag_count: number;
};
/** a tag suggested by the backend, with a color reflecting the tag's mood */
export type SuggestedTag = {
    name: string;
    color: string;
};
export function useSuggestTags() {
    const x = useAPIFetch<SuggestTagsParams, SuggestedTag[]>("/tags/suggest");
    return {
        suggestedTags: x.data,
        suggestTagsLoading: x.isMutating,
        suggestTagsErr: x.error,
        resetSuggestTags: x.reset,
        suggestTags: x.trigger,
    };
}

/**
 * Moves the signed in user's score for each named tag by the given amount, which
 * is how the app tracks the tags they are interested in. A tag name they have no
 * score for starts at its delta, and a negative delta lowers the score.
 *
 * Trigger it with the names and deltas together, so one interaction is one
 * request:
 *
 * ```ts
 * await editTagScores({ pop: 5, rock: 10, jazz: -2 });
 * ```
 *
 * Bumping a single tag is the one-key case, `editTagScores({ pop: 1 })`. Scores
 * go by tag name, not tag id, so default tags can be scored as well. Names are
 * lowercased and whitespace-collapsed by the backend, and it returns the score
 * each one is left at.
 *
 * Invalidates every `useTopTagScores` read, since any edit can move the top
 * tags.
 */
export function useEditTagScores() {
    const x = useAPIMutation<TagScoreDeltas, TagScores>(
        "PATCH",
        "/tags/scores",
        [{ path: "/tags/scores" }],
    );
    return {
        editTagScoresErr: x.error,
        editTagScoresLoading: x.isMutating,
        resetEditTagScores: x.reset,
        editTagScores: x.trigger,
    };
}

/**
 * The signed in user's `k` highest tag scores, keyed by the lowercased tag
 * name. Each is `[score, color, source]`: the color is the user's own tag's
 * when they have one of that name (`local`), otherwise the default tag's
 * (`global`). Names with no tag at all are left out, and so are scores of 0 and
 * below. The map has no order, so sort it by score to rank it.
 */
export function useTopTagScores(k: number) {
    const x = useAPIData<TopTagScores>("/tags/scores", { k });

    return {
        topTagScores: x.data,
        topTagScoresLoading: x.isLoading,
        topTagScoresErr: x.error,
    };
}
