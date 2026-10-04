import type { ReactNode } from "react";
import { useLayoutEffect } from "react";
import { useNavigation } from "expo-router";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { PeriodBar } from "./PeriodControls";

type Props = {
    /** Set on the stack, so the top rail shows it. */
    title: string;
    /** Shown instead of the body when the read failed. */
    error?: unknown;
    errorLabel?: string;
    /** Shown instead of the body while the first read is in flight. */
    loading?: boolean;
    skeleton?: ReactNode;
    children: ReactNode;
};

/**
 * The shell every scrolling detail page on the Analytics tab shares: the period
 * bar pinned above a scroll view, and the error and loading states.
 *
 * The bar sits outside the scroll view on purpose. It drives every read on the
 * page, so it should not need scrolling back up to reach.
 *
 * The songs page does not use this: a playable list is a `MusicList`, which owns
 * its own list and cannot be nested in a scroll view.
 */
export function AnalyticsScrollScreen({
    title,
    error,
    errorLabel = "Could not load this list.",
    loading,
    skeleton,
    children,
}: Props) {
    const navigation = useNavigation();
    const { contentBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();

    useLayoutEffect(() => {
        navigation.setOptions({ title });
    }, [navigation, title]);

    return (
        <View className="flex-1 bg-background">
            <View className="px-5 pb-3 pt-5">
                <PeriodBar />
            </View>
            {/* the marker takes the scroller alone: it allows one direct child,
                and a layout-only wrapper flattens away, hoisting the chips into
                it */}
            <ScreenScrollMarker>
                <Animated.ScrollView
                    {...scroll}
                    className="flex-1"
                    contentContainerClassName="gap-4 px-5"
                    contentContainerStyle={[
                        { paddingBottom: contentBottomInset },
                        scroll.contentContainerStyle,
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    {error ? (
                        <Text className="text-muted-foreground text-sm">
                            {errorLabel}
                        </Text>
                    ) : loading ? (
                        skeleton
                    ) : (
                        children
                    )}
                </Animated.ScrollView>
            </ScreenScrollMarker>
        </View>
    );
}
