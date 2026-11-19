import type { AssistantAction } from "@/features/assistant/types";

import { invalidateAPIData, useAPIData, useAPIMutation } from "../api-actions";
import type { APIDataEndpoint } from "../api-endpoints";
import { ACTIVITY_TAG_READS } from "./activity-tag-reads";
import { ANALYTICS_READS } from "./analytics-reads";

const ACTIONS_PATH = "/assistant/actions";

/**
 * Every read a change from the assistant (or its undo) can move: tags and the
 * songs that carry them, query results, saved queries, shared playlists, and
 * the activity log itself. Broad on purpose: a change is rare and the user is
 * looking at its result.
 */
export function assistantChangeReads(
    actions: readonly AssistantAction[] = [],
): APIDataEndpoint[] {
    const playlists = actions.flatMap((action) =>
        action.target?.kind === "shared_playlist"
            ? [{ path: `/shared-playlists/${action.target.id}` }]
            : [],
    );
    const savedQueries = actions.flatMap((action) =>
        action.target?.kind === "saved_query"
            ? [{ path: `/saved-queries/${action.target.id}/songs` }]
            : [],
    );
    return [
        { path: ACTIONS_PATH },
        { path: "/tags" },
        { path: "/songs/local-tags" },
        { path: "/songs/local-tags/batch" },
        { path: "/queries/results" },
        { path: "/saved-queries" },
        { path: "/shared-playlists" },
        ...playlists,
        ...savedQueries,
        ...ACTIVITY_TAG_READS,
        ...ANALYTICS_READS,
    ];
}

/** Refreshes what the assistant's changes can move, without waiting for it. */
export function refreshAfterAssistantChanges(
    actions: readonly AssistantAction[],
) {
    if (actions.length === 0) return;
    void invalidateAPIData(assistantChangeReads(actions)).catch((error) =>
        console.error("Could not refresh after an assistant change", error),
    );
}

/** The activity log: the changes the user confirmed in the assistant, newest first. */
export function useAssistantActions() {
    const x = useAPIData<{ actions: AssistantAction[] }>(ACTIONS_PATH);
    return {
        actions: x.data?.actions,
        actionsLoading: x.isLoading,
        actionsErr: x.error,
        reloadActions: x.mutate,
    };
}

export type UndoActionResult = { action: AssistantAction; message: string };

/**
 * Undoes one change from the log. The backend reverses exactly what it did and
 * leaves alone anything changed since; `message` says what it did.
 */
export function useUndoAssistantAction() {
    const x = useAPIMutation<AssistantAction, UndoActionResult>(
        "POST",
        (action) => `${ACTIONS_PATH}/${action.id}/undo`,
        (action) => assistantChangeReads([action]),
    );
    return {
        undoAction: x.trigger,
        undoing: x.isMutating,
        undoErr: x.error,
    };
}
