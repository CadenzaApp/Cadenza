import { Stack } from "expo-router";

import { TopRail } from "@/components/custom/top-rail";
import { TopRailProvider } from "@/lib/top-rail";

type Props = {
    title: string;
    /**
     * Route names whose rail is pinned instead of floating: screens with a
     * fixed bar above their scroller, which a floating rail would cover.
     */
    pinnedRail?: readonly string[];
    /**
     * Social tab: the initials button opens your own posts page instead of
     * Account.
     */
    opensOwnSocialPage?: boolean;
};

/**
 * A native stack for one tab, with Cadenza's shared top rail as its header.
 * The rail floats over each screen, fading away as its scroller runs down and
 * back once it reaches the top, unless the route is in `pinnedRail`.
 */
export function TabStack({ title, pinnedRail, opensOwnSocialPage }: Props) {
    return (
        <TopRailProvider pinned={pinnedRail}>
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
                            opensOwnSocialPage={opensOwnSocialPage}
                        />
                    ),
                }}
            >
                <Stack.Screen name="index" options={{ title }} />
            </Stack>
        </TopRailProvider>
    );
}
