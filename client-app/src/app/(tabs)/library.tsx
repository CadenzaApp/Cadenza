import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useLayoutEffect } from "react";
import { Platform, ScrollView, View } from "react-native";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import type { LibraryCategory } from "@/features/library/categories";
import { CategoryRow } from "@/features/library/category-row";
import { useLibraryCategories } from "@/features/library/library-categories";
import { RecentlyAdded } from "@/features/library/recently-added";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { getErrorMessage } from "@/lib/error-utils";
import { useTracksFromLibrary } from "@/lib/musickit-hooks";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";

const RECENTLY_ADDED_COUNT = 6;
/** Android's library request ignores sort, so there is nothing recent to show. */
const SUPPORTS_RECENTLY_ADDED = Platform.OS === "ios";
const RECENTLY_ADDED_SORT = {
    option: "dateAdded",
    direction: "descending",
} as const;

/**
 * The library index. A row per enabled category, then what was added most
 * recently. Tapping a row opens that category as a sheet; the top rail button
 * opens the sheet that picks which rows appear.
 */
export default function LibraryScreen() {
    const { enabled } = useLibraryCategories();
    const { isConnected } = useAppleMusic();
    const { contentBottomInset } = useScreenOverlayInsets();
    const navigation = useNavigation();
    const router = useRouter();
    const { colors } = useTheme();

    useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <GlassIconButton
                    accessibilityLabel="Choose what shows in your library"
                    onPress={() => router.push("/library-categories")}
                >
                    <Ionicons
                        name="list-outline"
                        size={20}
                        color={colors.text}
                    />
                </GlassIconButton>
            ),
        });
    }, [navigation, router, colors.text]);

    const { tracks, tracksLoading, tracksErr } = useTracksFromLibrary({
        enabled: isConnected && SUPPORTS_RECENTLY_ADDED,
        sort: RECENTLY_ADDED_SORT,
    });

    function openCategory(category: LibraryCategory) {
        router.push({
            pathname: "/category/[kind]",
            params: { kind: category },
        });
    }

    return (
        <ScrollView
            className="flex-1 bg-background"
            contentContainerStyle={{ paddingBottom: contentBottomInset }}
            showsVerticalScrollIndicator={false}
        >
            {tracksErr ? (
                <Text className="my-2 px-6 text-center text-destructive">
                    {getErrorMessage(tracksErr)}
                </Text>
            ) : null}

            <View className="px-6 pt-2">
                {enabled.map((category) => (
                    <CategoryRow
                        key={category}
                        category={category}
                        onPress={openCategory}
                    />
                ))}
            </View>

            {SUPPORTS_RECENTLY_ADDED ? (
                <RecentlyAdded
                    tracks={tracks.slice(0, RECENTLY_ADDED_COUNT)}
                    isLoading={tracksLoading}
                />
            ) : null}
        </ScrollView>
    );
}
