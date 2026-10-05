import { useMemo } from "react";

import { useAPIData, useAPIFetch, useAPIMutation } from "../api-actions";
import { queryTagIds, type QueryJSON } from "../query-json";
import {
    Tag,
    TagMetadata,
    TagScoreDeltas,
    TagScores,
    TagType,
} from "@/lib/types";

type UserTagsResponse = {
    All: { tags: Tag[]; metadata: Record<number, TagMetadata> };
};
export function useUserTags(enabled = true) {
    const x = useAPIData<UserTagsResponse>("/tags", undefined, { enabled });

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

/**
 * Every activity tag (My Plays, First Played, Last Played), in display order.
 * The same for every user. Kept out of `useUserTags`, so they never show on
 * the Tags pages, and offered separately by the query builders.
 */
export function useActivityTags() {
    const x = useAPIData<Tag[]>("/tags/activity");

    return {
        activityTags: x.data,
        activityTagsLoading: x.isLoading,
        activityTagsErr: x.error,
    };
}

const NO_TAG_IDS: readonly number[] = [];

/**
 * The ids of the activity tags `query` filters on, in query order, so the
 * result rows can show exactly those. Empty for no query, or while the
 * activity tag list is still loading.
 */
export function useActivityTagIdsInQuery(
    query: QueryJSON | null,
): readonly number[] {
    const { activityTags } = useActivityTags();

    return useMemo(() => {
        if (!query || !activityTags?.length) return NO_TAG_IDS;
        const activityIds = new Set(activityTags.map((tag) => tag.id));
        const ids = queryTagIds(query).filter((id) => activityIds.has(id));
        return ids.length > 0 ? ids : NO_TAG_IDS;
    }, [activityTags, query]);
}

type NewTagPayload = {
    name: string;
    color: string;
    type: TagType;
};

export function tagMutationErrorMessage(error: unknown) {
    if (
        typeof error === "object" &&
        error !== null &&
        "error_type" in error &&
        error.error_type === "TagNameAlreadyTaken"
    ) {
        return "You already have a tag with that name.";
    }

    return "Couldn't save this tag. Please try again.";
}

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

type UpdateTagPayload = {
    tag_id: number;
    name?: string;
    color?: string;
};
export function useUpdateTag() {
    const x = useAPIMutation<UpdateTagPayload, Tag>(
        "PATCH",
        "/tags",
        [
            { path: "/songs/local-tags" },
            { path: "/songs/local-tags/batch" },
            { path: "/tags" },
            { path: "/tags/scores" },
        ],
        { invalidation: "await" },
    );
    return {
        updateTagErr: x.error,
        updateTagLoading: x.isMutating,
        resetUpdateTag: x.reset,
        updateTag: x.trigger,
    };
}

export function useDeleteTag() {
    const x = useAPIMutation<{ tag_id: number }, void>(
        "DELETE",
        "/tags",
        [
            { path: "/songs/local-tags" },
            { path: "/songs/local-tags/batch" },
            { path: "/tags" },
            // a deleted tag can drop out of the top tags or fall back to global
            { path: "/tags/scores" },
        ],
        { invalidation: "await" },
    );
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
 * Nothing reads the scores back any more: the Analytics tab shows tags by plays
 * in a window instead, which `tag_scores` cannot answer since it has no
 * timestamp. The scores are still written and still decay weekly, as the input
 * for recommendations. The invalidation is kept for whatever reads them next.
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
