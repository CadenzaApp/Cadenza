import { useCallback, useReducer, type SetStateAction } from "react";
import type { AdvancedGroupNode } from "../advanced-query-builder/types";
import { withOuterConnector } from "../query-builder/QueryConversion";
import type { QueryCondition } from "../query-builder/types";
import { DEFAULT_QUERY_SETTINGS } from "./query-settings";
import { workspaceReducer, type QueryWorkspace } from "./query-workspace";
const INITIAL_WORKSPACE: QueryWorkspace = {
    mode: "simple",
    conditions: [],
    connector: "and",
    advancedRoot: {
        kind: "group",
        id: "initial-root",
        conjunction: "and",
        children: [],
    },
    advancedInitialized: false,
    includeSuggested: DEFAULT_QUERY_SETTINGS.includeSuggested,
    suggestedTags: [],
};

export function useQueryWorkspace() {
    const [history, dispatch] = useReducer(workspaceReducer, {
        present: INITIAL_WORKSPACE,
        past: [],
        future: [],
        suspended: {
            simple: { past: [], future: [] },
            advanced: { past: [], future: [] },
        },
    });
    const edit = useCallback(
        (
            update: (value: QueryWorkspace) => QueryWorkspace,
            coalesceKey?: string,
        ) => dispatch({ type: "edit", update, coalesceKey, at: Date.now() }),
        [],
    );
    const navigate = useCallback(
        (update: (value: QueryWorkspace) => QueryWorkspace) =>
            dispatch({ type: "navigate", update }),
        [],
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
