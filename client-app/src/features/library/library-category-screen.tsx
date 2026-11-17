import { useLocalSearchParams, useNavigation } from "expo-router";
import { useLayoutEffect } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui/text";

import {
    LIBRARY_CATEGORY_META,
    parseLibraryCategory,
    type LibraryCategory,
} from "./categories";
import { LibraryArtists } from "./library-artists";
import { LibraryCollections } from "./library-collections";
import { LibraryPlaylists } from "./library-playlists";
import { LibrarySongs } from "./library-songs";
import { SavedQueriesView } from "./saved-queries-view";
import { TagsView } from "./tags-view";

/** The Library category bodies, pushed in the Library tab's stack. */
export function LibraryCategoryScreen() {
    const { kind } = useLocalSearchParams<{ kind: string }>();
    const category = parseLibraryCategory(kind);
    const navigation = useNavigation();
    const title = category ? LIBRARY_CATEGORY_META[category].label : "Library";

    useLayoutEffect(() => {
        navigation.setOptions({ title });
    }, [navigation, title]);

    return (
        <View className="flex-1 bg-background">
            {category ? (
                <CategoryBody category={category} />
            ) : (
                <Text className="px-5 py-10 text-center text-muted-foreground">
                    Unknown library section.
                </Text>
            )}
        </View>
    );
}

/**
 * One body per category, each owning its reads, so opening Albums does not
 * fetch songs. Songs, Albums, and Queries can be played whole; Artists and
 * Playlists only searched.
 */
function CategoryBody({ category }: { category: LibraryCategory }) {
    switch (category) {
        case "song":
            return <LibrarySongs />;
        case "album":
            return <LibraryCollections kind="album" playable />;
        case "playlist":
            return <LibraryPlaylists />;
        case "artist":
            return <LibraryArtists />;
        case "query":
            return <SavedQueriesView />;
        case "tag":
            return <TagsView />;
    }
}
