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
import { useAppleMusic } from "@/lib/apple-music";
import { Tag } from "@/types/tag-types";
import { useTags } from "@/lib/tags";

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
    const [tracks, setTracks] = useState<AppleMusicItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Search State
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<AppleMusicItem[]>([]);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Modal State
    const [selectedSong, setSelectedSong] = useState<AppleMusicItem | null>(
        null,
    );
    const [isSongDetailModalOpen, setIsSongDetailModalOpen] = useState(false);

    const { isInitializing, isConnected, ensureConnected } = useAppleMusic();
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();
    const { songTagsMap, loadSongTags, applyTag, removeTag } = useTags();

    async function handleFetchLibrary() {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before loading your library.",
            );
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            await ensureConnected();
            const [result] = await Promise.all([
                MusicKit.getTracksFromLibrary(),
                loadSongTags(),
            ]);
            setTracks(result.items || []);
        } catch (e) {
            console.error(
                "Failed to fetch library tracks:",
                getErrorDetails(e),
            );
            setError(`Failed to load library tracks. ${getErrorMessage(e)}`);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleSearch() {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }

        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before searching.",
            );
            return;
        }

        setIsSearchLoading(true);
        setSearchError(null);

        try {
            await ensureConnected();
            const result = await MusicKit.catalogSearch(searchQuery, ["songs"]);
            setSearchResults(result.songs || []);
        } catch (e) {
            console.error("Failed to search catalog:", getErrorDetails(e));
            setSearchError(`Failed to search catalog. ${getErrorMessage(e)}`);
        } finally {
            setIsSearchLoading(false);
        }
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

    function handleTrackSelected(track: AppleMusicItem, _tags: Tag[]) {
        setSelectedSong(track);
        setIsSongDetailModalOpen(true);
    }

    async function handleApplyTag(tag: Tag) {
        if (!selectedSong?.id) return;
        await applyTag(selectedSong.id, tag);
    }

    async function handleRemoveTag(tag: Tag) {
        if (!selectedSong?.id) return;
        await removeTag(selectedSong.id, tag);
    }

    const selectedSongTags = selectedSong?.id
        ? (songTagsMap[selectedSong.id] ?? [])
        : [];

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
                    <View className="px-6 mb-4">
                        <Button
                            onPress={handleFetchLibrary}
                            disabled={
                                isInitializing || isLoading || !isConnected
                            }
                        >
                            <Text>
                                {isLoading
                                    ? "Loading..."
                                    : "Load Library Songs"}
                            </Text>
                        </Button>
                    </View>

                    {error && (
                        <Text className="text-destructive text-center my-2 px-6">
                            {error}
                        </Text>
                    )}

                    <MusicList
                        tracks={tracks}
                        isLoading={isLoading}
                        activeTrackId={activeTrackId}
                        isPlaying={isPlaying}
                        onTogglePlayback={handleTogglePlayback}
                        onSelectTrack={handleTrackSelected}
                        songTagsMap={songTagsMap}
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
                            editable={!isSearchLoading}
                        />
                        <Button
                            size="icon"
                            className="rounded-full"
                            onPress={handleSearch}
                            disabled={
                                isInitializing ||
                                isSearchLoading ||
                                !isConnected
                            }
                        >
                            <Text>
                                {isSearchLoading ? (
                                    "..."
                                ) : (
                                    <Ionicons name="search" size={20} />
                                )}
                            </Text>
                        </Button>
                    </View>

                    {searchError && (
                        <Text className="text-destructive text-center my-2 px-6">
                            {searchError}
                        </Text>
                    )}

                    <MusicList
                        tracks={searchResults}
                        isLoading={isSearchLoading}
                        activeTrackId={activeTrackId}
                        isPlaying={isPlaying}
                        onTogglePlayback={handleTogglePlayback}
                        onSelectTrack={handleTrackSelected}
                        songTagsMap={songTagsMap}
                    />
                </TabsContent>
            </Tabs>

            <SongDetailModal
                open={isSongDetailModalOpen}
                onOpenChange={setIsSongDetailModalOpen}
                song={selectedSong}
                tags={selectedSongTags}
                onTogglePlayback={togglePlayback}
                isThisTrackPlaying={Boolean(
                    selectedSong?.id &&
                    activeTrackId === selectedSong.id &&
                    isPlaying,
                )}
                onApplyTag={handleApplyTag}
                onRemoveTag={handleRemoveTag}
            />
        </View>
    );
}
