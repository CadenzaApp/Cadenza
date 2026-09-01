import { useState } from "react";
import { View, Alert } from "react-native";
import { MusicKit, MusicItem as AppleMusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MusicList } from "@/components/custom/music-list";
import { SongDetailModal } from "@/components/custom/song-detail-modal";
import { usePlayback } from "@/lib/playback";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { Tag } from "@/lib/types";
import { useCatalogSearch, useTracksFromLibrary } from "@/lib/musickit-hooks";

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
    // Tab State
    const [activeTab, setActiveTab] = useState("library");

    // Library State
    const { tracks, tracksLoading, tracksErr } =  useTracksFromLibrary();

    const [searchQuery, setSearchQuery] = useState("");
    const {searchResults, searchCatalog, searchCatalogLoading, searchCatalogErr} = useCatalogSearch();


    // Modal State
    const [selectedSong, setSelectedSong] = useState<AppleMusicItem | null>(
        null,
    );

    const { isInitializing, isConnected, ensureConnected } = useAppleMusic();
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();

    async function handleSearch() {
        if (!searchQuery.trim()) {
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
        await searchCatalog({query: searchQuery, types: ["song"]});
    }

    async function handleTogglePlayback(trackId: string) {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before playing songs.",
            );
            return;
        }

        try {
            await ensureConnected();
            await togglePlayback(trackId);
        } catch (e) {
            console.error("Failed to toggle playback:", getErrorDetails(e));
            Alert.alert(
                "Playback Error",
                `Failed to update playback state. ${getErrorMessage(e)}`,
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

                {/* --- LIBRARY TAB --- */}
                <TabsContent value="library" className="flex-1">
                    {tracksLoading && (
                        <Text className="text-sm text-muted-foreground text-center my-2 px-6">
                            Loading...
                        </Text>
                    )}

                    {tracksErr && (
                        <Text className="text-destructive text-center my-2 px-6">
                            {JSON.stringify(tracksErr)}
                        </Text>
                    )}

                    <MusicList
                        tracks={tracks?.items ?? []}
                        isLoading={tracksLoading}
                        activeTrackId={activeTrackId}
                        isPlaying={isPlaying}
                        onTogglePlayback={handleTogglePlayback}
                        onSelectTrack={setSelectedSong}
                    />
                </TabsContent>

                {/* --- SEARCH TAB --- */}
                <TabsContent value="search" className="flex-1">
                    <View className="px-6 mb-4 flex-row gap-2">
                        <Input
                            className="flex-1 bg-input rounded-full mr-2 pl-4"
                            placeholder="Search Apple Music..."
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            onSubmitEditing={handleSearch}
                            returnKeyType="search"
                            editable={!searchCatalogLoading}
                        />
                        <Button
                            size="icon"
                            className="rounded-full"
                            onPress={handleSearch}
                            disabled={
                                isInitializing ||
                                searchCatalogLoading ||
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
                            {JSON.stringify(searchCatalogErr)}
                        </Text>
                    )}

                    <MusicList
                        tracks={searchResults?.songs ?? []}
                        isLoading={searchCatalogLoading}
                        activeTrackId={activeTrackId}
                        isPlaying={isPlaying}
                        onTogglePlayback={handleTogglePlayback}
                        onSelectTrack={setSelectedSong}
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
