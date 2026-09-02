import { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { type MusicItem as AppleMusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    DEFAULT_MUSIC_LIST_SORT_OPTIONS,
    MusicList,
    MUSIC_LIST_SORT_OPTIONS,
    type MusicListSort,
} from "@/components/custom/music-list";
import { SongDetailModal } from "@/components/custom/song-detail-modal";
import { usePlayback } from "@/lib/playback";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useCatalogSearch, useTracksFromLibrary } from "@/lib/musickit-hooks";

const DEFAULT_LIBRARY_SORT: MusicListSort = {
    option: "title",
    direction: "ascending",
};
const LIBRARY_SORT_OPTIONS =
    Platform.OS === "ios"
        ? MUSIC_LIST_SORT_OPTIONS
        : DEFAULT_MUSIC_LIST_SORT_OPTIONS;

function getErrorDetails(error: unknown) {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            code: (error as any).code,
            nativeStackIOS: (error as any).nativeStackIOS,
            cause: (error as any).cause,
        };
    }

    if (typeof error === "object" && error !== null) {
        return error;
    }

    return { message: String(error) };
}

function getErrorMessage(error: unknown) {
    const details = getErrorDetails(error);

    if (
        typeof details === "object" &&
        details !== null &&
        "message" in details
    ) {
        return String(details.message);
    }

    return "Unknown error";
}

export default function ExploreScreen() {
    const [activeTab, setActiveTab] = useState("library");
    const [librarySort, setLibrarySort] =
        useState<MusicListSort>(DEFAULT_LIBRARY_SORT);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedSong, setSelectedSong] = useState<AppleMusicItem | null>(
        null,
    );

    const { isInitializing, isConnected, ensureConnected } = useAppleMusic();
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();
    const nativeLibrarySort =
        librarySort.option === "dateAdded"
            ? { option: "dateAdded" as const, direction: librarySort.direction }
            : undefined;
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
    } = useCatalogSearch(isConnected);

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
        searchCatalog({ query, types: ["songs"] });
    }

    async function handleTogglePlayback(track: AppleMusicItem) {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before playing songs.",
            );
            return;
        }

        try {
            await ensureConnected();
            await togglePlayback(track);
        } catch (error) {
            console.error("Failed to toggle playback:", getErrorDetails(error));
            Alert.alert(
                "Playback Error",
                `Failed to update playback state. ${getErrorMessage(error)}`,
            );
        }
    }

    return (
        <View className="flex-1 bg-background pt-8">
            <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex-1 flex-col"
            >
                <View className="px-6 mb-4">
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
                        activeTrackId={activeTrackId}
                        isPlaying={isPlaying}
                        onTogglePlayback={handleTogglePlayback}
                        onSelectTrack={setSelectedSong}
                        hasNextPage={hasNextLibraryPage}
                        isLoadingNextPage={tracksLoadingNextPage}
                        onLoadNextPage={loadNextLibraryPage}
                        sortOptions={LIBRARY_SORT_OPTIONS}
                        onSortChange={setLibrarySort}
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
                        activeTrackId={activeTrackId}
                        isPlaying={isPlaying}
                        onTogglePlayback={handleTogglePlayback}
                        onSelectTrack={setSelectedSong}
                        hasNextPage={hasNextSearchPage}
                        isLoadingNextPage={isLoadingNextSearchPage}
                        onLoadNextPage={loadNextSearchPage}
                        showSort={false}
                    />
                </TabsContent>
            </Tabs>

            <SongDetailModal
                open={selectedSong != null}
                onClose={() => setSelectedSong(null)}
                song={selectedSong}
                onTogglePlayback={togglePlayback}
                isThisTrackPlaying={Boolean(
                    selectedSong?.id &&
                    activeTrackId === selectedSong.id &&
                    isPlaying,
                )}
            />
        </View>
    );
}
