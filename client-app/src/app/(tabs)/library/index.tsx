import type { MusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useLayoutEffect } from "react";
import { View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import type { LibraryCategory } from "@/features/library/categories";
import { CategoryRow } from "@/features/library/category-row";
import { useLibraryCategories } from "@/features/library/library-categories";
import { RecentlyAddedGrid } from "@/features/library/recently-added";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { collectionRoute } from "@/lib/music-routes";
import { useRecentlyAdded } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";

/**
 * The library index. A row per enabled category, then the recently added feed.
 * Tapping a row opens that category as a sheet; the top rail button opens the
 * sheet that picks which rows appear.
 */
export default function LibraryScreen() {
    const { enabled } = useLibraryCategories();
    const { isConnected } = useAppleMusic();
    const navigation = useNavigation();
    const openScreen = useOpenScreen();
    const { colors } = useTheme();

    useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <GlassIconButton
                    accessibilityLabel="Choose what shows in your library"
                    onPress={() => openScreen("/library-categories")}
                >
                    <Ionicons
                        name="list-outline"
                        size={20}
                        color={colors.text}
                    />
                </GlassIconButton>
            ),
        });
    }, [navigation, openScreen, colors.text]);

    const {
        recentlyAdded,
        recentlyAddedLoading,
        recentlyAddedLoadingNextPage,
        loadNextRecentlyAddedPage,
        hasNextRecentlyAddedPage,
        recentlyAddedErr,
    } = useRecentlyAdded(isConnected);

    function openCategory(category: LibraryCategory) {
        openScreen({
            pathname: "/library/category/[kind]",
            params: { kind: category },
        });
    }

    function openCollection(collection: MusicItem) {
        openScreen(collectionRoute(collection));
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
                        <ErrorNotice error={recentlyAddedErr} />
                    ) : null}

                    <View className="px-6">
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
