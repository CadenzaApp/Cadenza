import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable } from "react-native";

import { Text } from "@/components/ui/text";
import type { AnalyticsSummary, EntityPlayCount } from "@/lib/routes/analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { DIMENSIONS, type TopDimension } from "./dimensions";
import { SegmentedBar } from "./SegmentedBar";
import { TopEntityList } from "./TopEntityList";

/** How many rows the card shows before "See all". */
const PREVIEW_COUNT = 5;

const SEGMENTS = DIMENSIONS.map(({ name, label, icon }) => ({
    value: name,
    label,
    icon,
}));
const BY_NAME = new Map(
    DIMENSIONS.map((dimension) => [dimension.name, dimension]),
);

/**
 * Every ranking in one card, with a small tab bar across the top for which
 * one. Songs by default.
 *
 * The bar and the "See all" both read the dimension registry, so a new
 * dimension shows up here with no change. A song row plays, everything else
 * opens its own page.
 */
export function TopRankingsCard({
    top,
    accent,
}: {
    top: AnalyticsSummary["top"];
    accent: string | null;
}) {
    const router = useRouter();
    const [selected, setSelected] = useState<TopDimension>("song");
    const dimension = BY_NAME.get(selected) ?? DIMENSIONS[0];
    const entries = (top[selected] ?? NO_ENTRIES).slice(0, PREVIEW_COUNT);
    const seeAll = `See all ${dimension.label.toLowerCase()}`;

    return (
        <AnalyticsCard>
            <Text role="heading" className="text-lg font-semibold">
                Most Played
            </Text>
            <SegmentedBar
                segments={SEGMENTS}
                selected={selected}
                onSelect={setSelected}
                accent={accent}
            />
            <TopEntityList dimension={dimension} entries={entries} />
            {entries.length > 0 ? (
                <Pressable
                    onPress={() => router.push(dimension.seeAllHref)}
                    accessibilityRole="button"
                    hitSlop={8}
                    className="self-start"
                >
                    <Text className="text-muted-foreground text-sm">
                        {seeAll}
                    </Text>
                </Pressable>
            ) : null}
        </AnalyticsCard>
    );
}

/** Stable, so a ranking the summary left out does not churn the list. */
const NO_ENTRIES: EntityPlayCount[] = [];
