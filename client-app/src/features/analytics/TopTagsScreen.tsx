import { useLayoutEffect } from "react";
import { useNavigation } from "expo-router";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAnalyticsTopTags, type TagPlayCount } from "@/lib/routes/analytics";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { useAnalyticsRange } from "./analytics-range";
import { RangeChips } from "./RangeChips";
import { TopTagList } from "./TopTagList";

/**
 * The tags the user listens to over the selected range, by plays of the songs
 * carrying them.
 *
 * This is a play count, not the decaying interest score that used to sit in
 * Account settings, so it answers "what did I listen to this month" and moves
 * with the range filter.
 */
export function TopTagsScreen() {
    const navigation = useNavigation();
    const { contentBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();
    const { resolved } = useAnalyticsRange();
    const { topTags, topTagsLoading, topTagsErr } = useAnalyticsTopTags({
        since: resolved.since,
        until: resolved.until,
    });

    useLayoutEffect(() => {
        navigation.setOptions({ title: "Tags" });
    }, [navigation]);

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
                    {topTagsErr ? (
                        <Text className="text-muted-foreground text-sm">
                            Could not load your tags.
                        </Text>
                    ) : topTagsLoading && !topTags ? (
                        <Skeleton className="h-24 w-full rounded" />
                    ) : (
                        <TopTagList
                            tags={topTags?.entries ?? NO_TAGS}
                            emptyLabel="Tag some songs and play them to see this."
                        />
                    )}
                </Animated.ScrollView>
            </View>
        </ScreenScrollMarker>
    );
}

/** Stable, so a pending read does not give the list a new array each render. */
const NO_TAGS: TagPlayCount[] = [];
