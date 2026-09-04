import { useState } from "react";
import { Alert, Platform, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    MusicList,
    MUSIC_LIST_SORT_OPTIONS,
    type MusicListSort,
} from "@/components/custom/music-list";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { getErrorMessage } from "@/lib/error-utils";
import {
    useCatalogSongSearch,
    useTracksFromLibrary,
} from "@/lib/musickit-hooks";

const DEFAULT_LIBRARY_SORT: MusicListSort = {
    option: Platform.OS === "ios" ? "dateAdded" : "title",
    direction: Platform.OS === "ios" ? "descending" : "ascending",
};
const LIBRARY_SORT_OPTIONS =
    Platform.OS === "ios" ? MUSIC_LIST_SORT_OPTIONS : ([] as const);
const DEFAULT_MULTI_SELECT_CONFIG = {} as const;

export default function ExploreScreen() {
    const [activeTab, setActiveTab] = useState("library");
    const [librarySort, setLibrarySort] =
        useState<MusicListSort>(DEFAULT_LIBRARY_SORT);
    const [searchQuery, setSearchQuery] = useState("");
    const { isInitializing, isConnected, ensureConnected } = useAppleMusic();
    const nativeLibrarySort = Platform.OS === "ios" ? librarySort : undefined;
    const {
        tracks,
        tracksLoading,
        tracksLoadingNextPage,
        loadNextLibraryPage,
        hasNextLibraryPage,
        tracksErr,
    } = useTracksFromLibrary({
        enabled: isConnected,
        sort: nativeLibrarySort,
    });
    const {
        searchResults,
        searchCatalog,
        clearSearchCatalog,
        loadNextSearchPage,
        hasNextSearchPage,
        searchCatalogLoading,
        isLoadingNextSearchPage,
        searchCatalogErr,
    } = useCatalogSongSearch(isConnected);

    async function handleSearch() {
        const query = searchQuery.trim();
        if (!query) {
            clearSearchCatalog();
            return;
        }

        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before searching.",
            );
            return;
        }

        await ensureConnected();
        searchCatalog(query);
    }

    return (
        <View className="flex-1 bg-background pt-8">
            <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex-1 flex-col"
            >
                <View className="mb-1 px-6">
                    <TabsList className="w-full flex-row">
                        <TabsTrigger value="library" className="flex-1">
                            <Text>My Library</Text>
                        </TabsTrigger>
                        <TabsTrigger value="search" className="flex-1">
                            <Text>Search</Text>
                        </TabsTrigger>
                    </TabsList>
                </View>

                <TabsContent value="library" className="flex-1">
                    {tracksErr && (
                        <Text className="text-destructive text-center my-2 px-6">
                            {getErrorMessage(tracksErr)}
                        </Text>
                    )}

                    <MusicList
                        tracks={tracks}
                        isLoading={tracksLoading}
                        hasNextPage={hasNextLibraryPage}
                        isLoadingNextPage={tracksLoadingNextPage}
                        onLoadNextPage={loadNextLibraryPage}
                        sortOptions={LIBRARY_SORT_OPTIONS}
                        sort={librarySort}
                        onSortChange={setLibrarySort}
                        multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                        fullBleedRows
                    />
                </TabsContent>

                <TabsContent value="search" className="flex-1">
                    <View className="px-6 mb-4 flex-row gap-2">
                        <Input
                            className="flex-1 bg-input rounded-full mr-2 pl-4"
                            placeholder="Search Apple Music..."
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            onSubmitEditing={() => void handleSearch()}
                            returnKeyType="search"
                            editable={!searchCatalogLoading}
                        />
                        <Button
                            size="icon"
                            className="rounded-full"
                            onPress={() => void handleSearch()}
                            disabled={
                                isInitializing ||
                                searchCatalogLoading ||
                                isLoadingNextSearchPage ||
                                !isConnected
                            }
                        >
                            <Text>
                                {searchCatalogLoading ? (
                                    "..."
                                ) : (
                                    <Ionicons name="search" size={20} />
                                )}
                            </Text>
                        </Button>
                    </View>

                    {searchCatalogErr && (
                        <Text className="text-destructive text-center my-2 px-6">
                            {getErrorMessage(searchCatalogErr)}
                        </Text>
                    )}

                    <MusicList
                        tracks={searchResults}
                        isLoading={searchCatalogLoading}
                        hasNextPage={hasNextSearchPage}
                        isLoadingNextPage={isLoadingNextSearchPage}
                        onLoadNextPage={loadNextSearchPage}
                        showSort={false}
                        multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                        fullBleedRows
                    />
                </TabsContent>
            </Tabs>
        </View>
    );
}
