import type { MusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useLayoutEffect } from "react";
import { View } from "react-native";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import type { LibraryCategory } from "@/features/library/categories";
import { CategoryRow } from "@/features/library/category-row";
import { useLibraryCategories } from "@/features/library/library-categories";
import { RecentlyAddedGrid } from "@/features/library/recently-added";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { getErrorMessage } from "@/lib/error-utils";
import { collectionRoute } from "@/lib/music-routes";
import { useRecentlyAdded } from "@/lib/musickit-hooks";

/**
 * The library index. A row per enabled category, then the recently added feed.
 * Tapping a row opens that category as a sheet; the top rail button opens the
 * sheet that picks which rows appear.
 */
export default function LibraryScreen() {
    const { enabled } = useLibraryCategories();
    const { isConnected } = useAppleMusic();
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

    const {
        recentlyAdded,
        recentlyAddedLoading,
        recentlyAddedLoadingNextPage,
        loadNextRecentlyAddedPage,
        hasNextRecentlyAddedPage,
        recentlyAddedErr,
    } = useRecentlyAdded(isConnected);

    function openCategory(category: LibraryCategory) {
        router.push({
            pathname: "/library/category/[kind]",
            params: { kind: category },
        });
    }

    function openCollection(collection: MusicItem) {
        router.push(collectionRoute(collection));
    }

    return (
        <RecentlyAddedGrid
            items={recentlyAdded}
            isLoading={recentlyAddedLoading}
            isLoadingNextPage={recentlyAddedLoadingNextPage}
            hasNextPage={hasNextRecentlyAddedPage}
            onLoadNextPage={loadNextRecentlyAddedPage}
            onOpenCollection={openCollection}
            header={
                <View>
                    {recentlyAddedErr ? (
                        <Text className="my-2 px-6 text-center text-destructive">
                            {getErrorMessage(recentlyAddedErr)}
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
                </View>
            }
        />
    );
}
