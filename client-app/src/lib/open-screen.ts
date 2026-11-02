import { useNavigationContainerRef, useRouter, type Href } from "expo-router";
import {
    CommonActions,
    StackActions,
    type NavigationState,
    type PartialState,
} from "expo-router/react-navigation";
import { useCallback } from "react";

import { detailRouteFor, routesAfterOpening } from "./detail-stack";

export type OpenScreenOptions = {
    /**
     * A root route to close on the way, by name, like the now playing sheet.
     * The screen opens in the tab underneath it, in the same step.
     */
    closing?: string;
};

/**
 * Opens a screen. Use it in place of `router.push` for anything that can
 * open a detail screen.
 *
 * Detail screens live in every tab's stack, so a detail href opens in the
 * current tab. It goes through `routesAfterOpening`, applied as one reset of
 * that tab's stack, so it never stacks a copy of a screen already open and
 * never piles up past the cap. Any other href is a plain push.
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
            const found =
                target && navigation.isReady()
                    ? navigatorFor(
                          navigation.getRootState(),
                          target.name,
                          closing,
                      )
                    : undefined;
            if (!target || !found) {
                if (closing) router.back();
                router.push(href);
                return;
            }

            const { state, closingIn } = found;
            const routes = routesAfterOpening(state.routes, target);
            const unchanged =
                routes.length === state.routes.length &&
                routes.every((route, i) => route === state.routes[i]);
            if (!unchanged) {
                navigation.dispatch({
                    ...CommonActions.reset({
                        ...state,
                        routes: routes as typeof state.routes,
                        index: routes.length - 1,
                    }),
                    target: state.key,
                });
            }
            if (closingIn) {
                navigation.dispatch({
                    ...StackActions.pop(),
                    target: closingIn,
                });
            }
        },
        [navigation, router],
    );
}

type AnyState = NavigationState | PartialState<NavigationState>;

/**
 * The navigator that owns `name`, walking down the focused routes from the
 * root. Not the root itself: expo-router wraps the app's root stack in a slot
 * navigator of its own.
 *
 * A focused route named `closing` is stepped over to the one beneath it, and
 * the key of the stack it sat in comes back as `closingIn`.
 */
function navigatorFor(
    root: AnyState,
    name: string,
    closing: string | undefined,
): { state: NavigationState; closingIn?: string } | undefined {
    let current: AnyState | undefined = root;
    let closingIn: string | undefined;
    while (current) {
        if (current.stale === false && current.routeNames.includes(name)) {
            return { state: current, closingIn };
        }
        let index: number = current.index ?? current.routes.length - 1;
        if (closing && current.routes[index]?.name === closing && index > 0) {
            closingIn = current.key;
            index -= 1;
        }
        current = current.routes[index]?.state;
    }
    return undefined;
}
