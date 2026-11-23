import { useNavigationContainerRef, useRouter } from "expo-router";
import {
    CommonActions,
    type NavigationState,
    type PartialState,
} from "expo-router/react-navigation";
import { useCallback } from "react";

import { requestQueryResults } from "@/features/cadenza/pending-results";
import { readQuerySettings } from "@/features/cadenza/query-settings";
import {
    dispatchWorkspace,
    getWorkspaceHistory,
} from "@/features/cadenza/query-workspace-store";
import { useAccount } from "@/lib/account";
import { describeQuery, positiveQueryTagNames } from "@/lib/query-json";
import { useActivityTags, useUserTags } from "@/lib/routes/tags";
import { encodeArrangementParam } from "@/lib/song-arrangement";

import { prepareHandoff } from "./query-handoff";
import type { AssistantCardQuery } from "./types";

const NO_TAGS: never[] = [];

type AnyState = NavigationState | PartialState<NavigationState>;

/**
 * The Cadenza tab's stack, when it has been opened, found anywhere in the
 * navigation tree: the assistant sheet is the focused route while this runs,
 * so the tabs are not on the focused path.
 */
function cadenzaStack(state: AnyState | undefined): NavigationState | null {
    if (!state) return null;
    if (state.routeNames?.includes("(cadenza)")) {
        const stack = state.routes.find(
            (route) => route.name === "(cadenza)",
        )?.state;
        return stack && stack.stale === false
            ? (stack as NavigationState)
            : null;
    }
    for (const route of state.routes) {
        const found = cadenzaStack(route.state);
        if (found) return found;
    }
    return null;
}

/**
 * Opens a `run_query` card's query the way the Cadenza tab would have made
 * it: loads it into the simple builder (or the advanced one) as one undo
 * step, closes the assistant, and switches to the Cadenza tab, which then
 * opens the results itself (`requestQueryResults`), sorted, grouped and
 * limited as the card ran. Back shows the builder holding the query; its Undo
 * brings back what the user had.
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
    const router = useRouter();
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
            requestQueryResults(accountId, {
                query: JSON.stringify(handoff.query),
                suggested: includeSuggested ? "1" : "",
                library: settings.libraryOrTagged ? "1" : "",
                relevantTags: JSON.stringify(
                    positiveQueryTagNames(handoff.query, allTags),
                ),
                name: describeQuery(handoff.query, allTags),
                arrangement: encodeArrangementParam(handoff.arrangement),
            });

            // anything open over the builder goes, so the builder is what
            // shows and opens the results, and Back from them lands on it
            const stack = container.isReady()
                ? cadenzaStack(container.getRootState())
                : null;
            if (stack && stack.routes.length > 1) {
                container.dispatch({
                    ...CommonActions.reset({
                        ...stack,
                        routes: stack.routes.slice(0, 1),
                        index: 0,
                    }),
                    target: stack.key,
                });
            }
            // the same way `open_screen` switches tabs
            if (router.canDismiss()) router.dismiss();
            router.navigate("/cadenza");
            return true;
        },
        [accountId, activity, container, own, router],
    );
}
