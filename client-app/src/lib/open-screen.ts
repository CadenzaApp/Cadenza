import { useNavigationContainerRef, useRouter, type Href } from "expo-router";
import {
    CommonActions,
    type NavigationState,
    type PartialState,
} from "expo-router/react-navigation";
import { useCallback } from "react";

import { detailRouteFor, routesAfterOpening } from "./detail-stack";

export type OpenScreenOptions = {
    /**
     * A root route to close on the way, by name, like the now playing sheet.
     * Closed in the same step as the open, since a separate `router.back()`
     * has not landed yet when the stack is read.
     */
    closing?: string;
};

/**
 * Opens a screen. Use it in place of `router.push` for anything that can
 * open a detail screen.
 *
 * A detail href goes through `routesAfterOpening`, applied as one reset of the
 * root stack, so it never stacks a copy of a screen already open and never
 * piles up past the cap. Any other href is a plain push.
 *
 * A hook rather than a router override because expo-router's `Stack` fixes
 * its own router and takes no other.
 */
export function useOpenScreen() {
    const router = useRouter();
    const navigation = useNavigationContainerRef();

    return useCallback(
        (href: Href, { closing }: OpenScreenOptions = {}) => {
            const target = detailRouteFor(href);
            const state = navigation.isReady()
                ? navigatorFor(navigation.getRootState(), target?.name)
                : undefined;
            if (!target || !state) {
                if (closing) router.back();
                router.push(href);
                return;
            }

            const routes = routesAfterOpening(
                state.routes.filter((route) => route.name !== closing),
                target,
            );
            const unchanged =
                routes.length === state.routes.length &&
                routes.every((route, i) => route === state.routes[i]);
            if (unchanged) return;

            navigation.dispatch({
                ...CommonActions.reset({
                    ...state,
                    routes: routes as typeof state.routes,
                    index: routes.length - 1,
                }),
                target: state.key,
            });
        },
        [navigation, router],
    );
}

type AnyState = NavigationState | PartialState<NavigationState>;

/**
 * The navigator that owns `name`, walking down the focused routes from the
 * root. Not the root itself: expo-router wraps the app's root stack in a slot
 * navigator of its own.
 */
function navigatorFor(
    root: AnyState,
    name: string | undefined,
): NavigationState | undefined {
    if (!name) return undefined;
    let current: AnyState | undefined = root;
    while (current) {
        if (current.stale === false && current.routeNames.includes(name)) {
            return current;
        }
        const focused: (typeof current.routes)[number] | undefined =
            current.routes[current.index ?? current.routes.length - 1];
        current = focused?.state;
    }
    return undefined;
}
