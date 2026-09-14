import { Redirect, Tabs } from "expo-router";

import { TABS } from "@/components/custom/tab-bar";
import { TopRail } from "@/components/custom/top-rail";
import { useAccount } from "@/lib/account";

/**
 * The five tabs. The bar itself is **not** here: it is mounted at the root, in
 * `../_layout.tsx`, next to the mini player, so it can float over a pushed
 * detail screen too. This navigator renders no bar of its own, and the tab
 * order lives with the bar in `TABS`.
 *
 * Nothing reserves space for either bar. Every scrolling surface owes itself
 * the padding from `useScreenOverlayInsets`.
 */
export default function TabLayout() {
    const { account } = useAccount();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    return (
        <Tabs
            tabBar={() => null}
            screenOptions={{
                // A screen contributes its own controls with
                // `navigation.setOptions({ headerRight })`, so the state behind
                // them stays in that screen rather than becoming shared.
                header: ({ options }) => (
                    <TopRail
                        title={
                            typeof options.title === "string"
                                ? options.title
                                : ""
                        }
                        actions={options.headerRight?.({ canGoBack: false })}
                    />
                ),
            }}
        >
            {TABS.map((tab) => (
                <Tabs.Screen
                    key={tab.segment}
                    name={tab.segment}
                    options={{ title: tab.label }}
                />
            ))}
        </Tabs>
    );
}
