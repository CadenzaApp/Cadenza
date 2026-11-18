import { useNavigation, useNavigationContainerRef } from "expo-router";
import {
    CommonActions,
    type NavigationState,
    type PartialState,
} from "expo-router/react-navigation";
import { useCallback } from "react";

import { readQuerySettings } from "@/features/cadenza/query-settings";
import {
    dispatchWorkspace,
    getWorkspaceHistory,
} from "@/features/cadenza/query-workspace-store";
import { useAccount } from "@/lib/account";
import { describeQuery, positiveQueryTagNames } from "@/lib/query-json";
import { useActivityTags, useUserTags } from "@/lib/routes/tags";
import { encodeArrangementParam } from "@/lib/song-arrangement";

import { cadenzaResultsNavigateAction, prepareHandoff } from "./query-handoff";
import type { AssistantCardQuery } from "./types";

const NO_TAGS: never[] = [];

type AnyState = NavigationState | PartialState<NavigationState>;

/**
 * The Cadenza tab's stack, when it has been opened and holds more than the
 * builder, walking down the focused routes to the tab navigator.
 */
function cadenzaStackAboveBuilder(root: AnyState): NavigationState | null {
    let current: AnyState | undefined = root;
    while (current) {
        if (current.routeNames?.includes("(cadenza)")) {
            const tab = current.routes.find(
                (route) => route.name === "(cadenza)",
            );
            const stack = tab?.state;
            return stack && stack.stale === false && stack.routes.length > 1
                ? (stack as NavigationState)
                : null;
        }
        const index: number = current.index ?? current.routes.length - 1;
        current = current.routes[index]?.state;
    }
    return null;
}

/**
 * Opens a `run_query` card's query the way the Cadenza tab would have made
 * it: loads it into the simple builder (or the advanced one) as one undo
 * step, switches to the Cadenza tab, and opens its results on top, sorted,
 * grouped and limited as the card ran. Back shows the builder holding the
 * query; its Undo brings back what the user had.
 *
 * The results follow the builder's settings as they are now, the same as the
 * builder's own results button, so an older card can disagree with them if
 * the settings changed since.
 *
 * Returns false, doing nothing, when the card cannot be handed over (its
 * query names a tag the user no longer has), so the caller can open the
 * card's songs as a plain list instead.
 */
export function useQueryHandoff() {
    const navigation = useNavigation();
    const container = useNavigationContainerRef();
    const { account } = useAccount();
    const accountId = account?.id ?? null;
    const { userTags } = useUserTags();
    const { activityTags } = useActivityTags();
    const own = userTags ?? NO_TAGS;
    const activity = activityTags ?? NO_TAGS;

    return useCallback(
        async (card: AssistantCardQuery): Promise<boolean> => {
            const handoff = prepareHandoff(card, { own, activity });
            if (!handoff) return false;
            const settings = await readQuerySettings();
            dispatchWorkspace(accountId, {
                type: "load",
                update: handoff.load,
            });
            // loading a suggested tag can turn suggestions on
            const includeSuggested =
                getWorkspaceHistory(accountId).present.includeSuggested;
            const allTags = [...own, ...activity];

            // anything already open over the builder goes, so Back from the
            // results lands on it
            const stack = container.isReady()
                ? cadenzaStackAboveBuilder(container.getRootState())
                : null;
            if (stack) {
                container.dispatch({
                    ...CommonActions.reset({
                        ...stack,
                        routes: stack.routes.slice(0, 1),
                        index: 0,
                    }),
                    target: stack.key,
                });
            }
            navigation.dispatch(
                cadenzaResultsNavigateAction({
                    query: JSON.stringify(handoff.query),
                    suggested: includeSuggested ? "1" : "",
                    library: settings.libraryOrTagged ? "1" : "",
                    relevantTags: JSON.stringify(
                        positiveQueryTagNames(handoff.query, allTags),
                    ),
                    name: describeQuery(handoff.query, allTags),
                    arrangement: encodeArrangementParam(handoff.arrangement),
                }),
            );
            return true;
        },
        [accountId, activity, container, navigation, own],
    );
}
