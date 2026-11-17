import { Stack } from "expo-router";

import { TopRail } from "@/components/custom/top-rail";
import { DETAIL_ROUTE_NAMES } from "@/lib/detail-stack";
import { TopRailProvider } from "@/lib/top-rail";

type Props = {
    /** The tab's folder inside its group, like `library` in `(library)/library`. */
    tab: string;
    title: string;
    /**
     * Route names, relative to `tab`, whose rail is pinned instead of
     * floating: screens with a fixed bar above their scroller, which a
     * floating rail would cover.
     */
    pinnedRail?: readonly string[];
    /**
     * Route names, relative to `tab`, kept to one copy per set of params. A
     * second push of the same route and params goes back to the open copy
     * instead of stacking another, so repeat taps cannot pile screens up.
     */
    singular?: readonly string[];
};

/** One stack entry per route name and params. */
const singularByParams = (name: string, params: Record<string, unknown>) =>
    `${name}:${JSON.stringify(params ?? {})}`;

/**
 * A native stack for one tab, with Cadenza's shared top rail as its header.
 * The rail floats over each screen, fading away as its scroller runs down and
 * back once it reaches the top, unless the route is in `pinnedRail`.
 *
 * Every tab also holds the shared detail routes (album, tag, artist, ...), so
 * they push inside the tab and keep the tab bar. They draw their own header.
 */
export function TabStack({ tab, title, pinnedRail, singular }: Props) {
    return (
        <TopRailProvider
            pinned={pinnedRail?.map((name) => `${tab}/${name}`)}
            railless={DETAIL_ROUTE_NAMES}
        >
            <Stack
                screenOptions={{
                    header: ({ options, navigation, back, route }) => (
                        <TopRail
                            route={route}
                            title={
                                typeof options.title === "string"
                                    ? options.title
                                    : title
                            }
                            onBack={
                                back ? () => navigation.goBack() : undefined
                            }
                            actions={options.headerRight?.({
                                canGoBack: navigation.canGoBack(),
                            })}
                        />
                    ),
                }}
            >
                <Stack.Screen name={`${tab}/index`} options={{ title }} />
                {singular?.map((name) => (
                    <Stack.Screen
                        key={name}
                        name={`${tab}/${name}`}
                        dangerouslySingular={singularByParams}
                    />
                ))}
                {DETAIL_ROUTE_NAMES.map((name) => (
                    <Stack.Screen
                        key={name}
                        name={name}
                        options={{ headerShown: false }}
                    />
                ))}
            </Stack>
        </TopRailProvider>
    );
}
