import type { Href } from "expo-router";
import { View } from "react-native";

import { PeekCarousel } from "@/components/custom/peek-carousel";
import { Text } from "@/components/ui/text";
import type { AnalyticsSummary, EntityPlayCount } from "@/lib/routes/analytics";

import { DIMENSIONS, type DimensionDescriptor } from "./dimensions";
import { SectionHeading } from "./SectionHeading";
import { ShelfTile } from "./ShelfTile";
import { useRankedRows } from "./use-ranked-rows";

/** How many tiles a shelf shows before "See all". */
export const SHELF_COUNT = 5;

/**
 * Every ranking as its own shelf: a heading with "See all", then the top five
 * as a peeking carousel of tiles. One shelf per entry in `DIMENSIONS`, in its
 * order, so a new dimension gets a shelf with no change here. A ranking with
 * nothing this period is left out; with nothing at all, one line says so.
 */
export function TopShelves({ top }: { top: AnalyticsSummary["top"] }) {
    const shelves = DIMENSIONS.flatMap((dimension) => {
        const entries = top[dimension.name] ?? [];
        return entries.length > 0
            ? [{ dimension, entries: entries.slice(0, SHELF_COUNT) }]
            : [];
    });

    if (shelves.length === 0) {
        return (
            <View className="gap-3">
                <SectionHeading title="Most Played" />
                <Text className="text-muted-foreground text-sm">
                    No plays in this window yet.
                </Text>
            </View>
        );
    }

    return (
        <>
            {shelves.map(({ dimension, entries }) => (
                <Shelf
                    key={dimension.name}
                    dimension={dimension}
                    entries={entries}
                />
            ))}
        </>
    );
}

function Shelf({
    dimension,
    entries,
}: {
    dimension: DimensionDescriptor;
    entries: readonly EntityPlayCount[];
}) {
    const rows = useRankedRows(dimension, entries);
    return (
        <View className="gap-3">
            <SectionHeading
                title={dimension.pageTitle}
                href={dimension.seeAllHref as Href}
            />
            <PeekCarousel
                items={rows}
                keyOf={(row) => row.key}
                renderItem={(row, width) => (
                    <ShelfTile
                        row={row}
                        width={width}
                        round={dimension.roundArtwork}
                    />
                )}
            />
        </View>
    );
}
