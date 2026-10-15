import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAnalyticsTop, type EntityPlayCount } from "@/lib/routes/analytics";

import { useAnalyticsPeriod } from "./analytics-period";
import { AnalyticsScrollScreen } from "./AnalyticsScrollScreen";
import { dimensionByName } from "./dimensions";
import { TopEntityList } from "./TopEntityList";

/**
 * One full ranking, for the dimensions whose rows navigate rather than play.
 *
 * Serves every dimension off its descriptor, so this is the whole of
 * `analytics/[dimension]`. Songs get their own screen, because a song row should
 * play and that means `MusicList`.
 */
export function TopEntityScreen() {
    const { dimension: name } = useLocalSearchParams<{ dimension: string }>();
    const descriptor = dimensionByName(name ?? "");
    const { period } = useAnalyticsPeriod();
    const { top, topLoading, topErr } = useAnalyticsTop(descriptor?.name, {
        since: period.since,
        until: period.until,
    });

    // an unknown dimension in the url, rather than a blank screen
    if (!descriptor) {
        return (
            <View className="flex-1 bg-background px-5 pt-5">
                <Text className="text-muted-foreground text-sm">
                    There is nothing to rank by {name}.
                </Text>
            </View>
        );
    }

    return (
        <AnalyticsScrollScreen
            title={descriptor.pageTitle}
            error={top ? undefined : topErr}
            loading={topLoading && !top}
            skeleton={
                <View className="gap-3">
                    {Array.from({ length: 8 }).map((_, index) => (
                        <Skeleton key={index} className="h-10 w-full rounded" />
                    ))}
                </View>
            }
        >
            <TopEntityList
                dimension={descriptor}
                entries={top?.entries ?? NO_ENTRIES}
            />
        </AnalyticsScrollScreen>
    );
}

/** Stable, so a pending read does not give the list a new array each render. */
const NO_ENTRIES: EntityPlayCount[] = [];
