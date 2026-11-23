import { useCallback, type SetStateAction } from "react";
import { useAccount } from "@/lib/account";
import type { AdvancedGroupNode } from "../advanced-query-builder/types";
import { withOuterConnector } from "../query-builder/QueryConversion";
import type { QueryCondition } from "../query-builder/types";
import type { QueryWorkspace, WorkspaceAction } from "./query-workspace";
import {
    dispatchWorkspace,
    useWorkspaceHistory,
} from "./query-workspace-store";

/**
 * The signed-in account's query drafts and history from the workspace store,
 * and the edits the screen makes to them.
 */
export function useQueryWorkspace() {
    const { account } = useAccount();
    const accountId = account?.id ?? null;
    const history = useWorkspaceHistory(accountId);
    const dispatch = useCallback(
        (action: WorkspaceAction) => dispatchWorkspace(accountId, action),
        [accountId],
    );
    const edit = useCallback(
        (
            update: (value: QueryWorkspace) => QueryWorkspace,
            coalesceKey?: string,
        ) => dispatch({ type: "edit", update, coalesceKey, at: Date.now() }),
        [dispatch],
    );
    const navigate = useCallback(
        (update: (value: QueryWorkspace) => QueryWorkspace) =>
            dispatch({ type: "navigate", update }),
        [dispatch],
    );
    const setConditions = useCallback(
        (update: SetStateAction<QueryCondition[]>) =>
            edit((current) => {
                const next =
                    typeof update === "function"
                        ? update(current.conditions)
                        : update;
                const normalized = withOuterConnector(next, current.connector);
                if (
                    normalized.length === current.conditions.length &&
                    normalized.every(
                        (item, index) => item === current.conditions[index],
                    )
                )
                    return current;
                const newSuggested = next
                    .flatMap((condition) =>
                        condition.kind === "tag"
                            ? [condition]
                            : condition.members,
                    )
                    .filter((tag) => tag.suggested)
                    .map((tag) => tag.tag);
                return {
                    ...current,
                    conditions: normalized,
                    suggestedTags: [
                        ...new Map(
                            [...current.suggestedTags, ...newSuggested].map(
                                (tag) => [tag.id, tag],
                            ),
                        ).values(),
                    ],
                };
            }),
        [edit],
    );
    const setAdvancedRoot = useCallback(
        (
            update: (root: AdvancedGroupNode) => AdvancedGroupNode,
            coalesceKey?: string,
        ) =>
            edit(
                (current) => ({
                    ...current,
                    advancedRoot: update(current.advancedRoot),
                }),
                coalesceKey,
            ),
        [edit],
    );

    return {
        history,
        dispatch,
        workspace: history.present,
        edit,
        navigate,
        setConditions,
        setAdvancedRoot,
    };
}
