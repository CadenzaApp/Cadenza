import { useLayoutEffect } from "react";
import { useNavigation } from "expo-router";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
    useAnalyticsTop,
    type EntityPlayCount,
    type TopDimension,
} from "@/lib/routes/analytics";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { useAnalyticsRange } from "./analytics-range";
import { RangeChips } from "./RangeChips";
import { TopEntityList } from "./TopEntityList";

type Props = {
    dimension: TopDimension;
    title: string;
    emptyLabel: string;
    roundArtwork?: boolean;
};

/**
 * One full ranking, for the dimensions whose rows navigate rather than play.
 *
 * Songs get their own screen instead, because a song row should play and that
 * means `MusicList`, which cannot live in a scroll view.
 */
export function TopEntityScreen({
    dimension,
    title,
    emptyLabel,
    roundArtwork,
}: Props) {
    const navigation = useNavigation();
    const { contentBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();
    const { resolved } = useAnalyticsRange();
    const { top, topLoading, topErr } = useAnalyticsTop(dimension, {
        since: resolved.since,
        until: resolved.until,
    });

    useLayoutEffect(() => {
        navigation.setOptions({ title });
    }, [navigation, title]);

    return (
        <ScreenScrollMarker>
            <View className="flex-1 bg-background">
                <View className="px-5 pb-3 pt-5">
                    <RangeChips />
                </View>
                <Animated.ScrollView
                    {...scroll}
                    className="flex-1"
                    contentContainerClassName="gap-4 px-5"
                    contentContainerStyle={{
                        paddingBottom: contentBottomInset,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {topErr ? (
                        <Text className="text-muted-foreground text-sm">
                            Could not load this list.
                        </Text>
                    ) : topLoading && !top ? (
                        <View className="gap-3">
                            {Array.from({ length: 8 }).map((_, index) => (
                                <Skeleton
                                    key={index}
                                    className="h-10 w-full rounded"
                                />
                            ))}
                        </View>
                    ) : (
                        <TopEntityList
                            dimension={dimension}
                            entries={top?.entries ?? NO_ENTRIES}
                            emptyLabel={emptyLabel}
                            roundArtwork={roundArtwork}
                        />
                    )}
                </Animated.ScrollView>
            </View>
        </ScreenScrollMarker>
    );
}

/** Stable, so a pending read does not give the list a new array each render. */
const NO_ENTRIES: EntityPlayCount[] = [];
