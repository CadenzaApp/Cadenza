import { useRef, useState } from "react";
import { Platform, View, Alert } from "react-native";
import { MusicKit, MusicItem as AppleMusicItem } from "@apple-musickit";
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
import { useAppleMusic } from "@/lib/apple-music";
import { Tag } from "@/lib/types";
import { useTags } from "@/lib/tags";

const LIBRARY_PAGE_SIZE = 25;
const SEARCH_PAGE_SIZE = 25;
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
    // Tab State
    const [activeTab, setActiveTab] = useState("library");

    // Library State
    const [tracks, setTracks] = useState<AppleMusicItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingNextLibraryPage, setIsLoadingNextLibraryPage] =
        useState(false);
    const [hasNextLibraryPage, setHasNextLibraryPage] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const nextLibraryOffset = useRef(0);
    const librarySort = useRef<MusicListSort>(DEFAULT_LIBRARY_SORT);
    const libraryRequestID = useRef(0);

    // Search State
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<AppleMusicItem[]>([]);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [isLoadingNextSearchPage, setIsLoadingNextSearchPage] =
        useState(false);
    const [hasNextSearchPage, setHasNextSearchPage] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const nextSearchOffset = useRef(0);
    const activeSearchQuery = useRef("");

    // Modal State
    const [selectedSong, setSelectedSong] = useState<AppleMusicItem | null>(
        null,
    );
    const [isSongDetailModalOpen, setIsSongDetailModalOpen] = useState(false);

    const { isInitializing, isConnected, ensureConnected } = useAppleMusic();
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();
    const { songTagsMap, loadSongTags, applyTag, removeTag } = useTags();

    async function handleFetchLibrary(sort = librarySort.current) {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before loading your library.",
            );
            return;
        }

        librarySort.current = sort;
        const requestID = ++libraryRequestID.current;
        setIsLoading(true);
        setError(null);
        setTracks([]);
        setHasNextLibraryPage(false);
        nextLibraryOffset.current = 0;

        try {
            await ensureConnected();
            // Tags supplement tracks, but must not prevent the library from
            // loading while the applied-tags database table is unavailable.
            void loadSongTags();

            const result = await MusicKit.getLibrarySongs(
                getLibrarySongRequestOptions(sort, 0),
            );
            const loadedTracks = result.items ?? [];
            if (requestID !== libraryRequestID.current) return;

            setTracks(loadedTracks);
            nextLibraryOffset.current = loadedTracks.length;
            setHasNextLibraryPage(
                hasNextLibraryResult(result, loadedTracks.length),
            );
        } catch (e) {
            console.error(
                "Failed to fetch library tracks:",
                getErrorDetails(e),
            );
            setError(`Failed to load library tracks. ${getErrorMessage(e)}`);
        } finally {
            if (requestID === libraryRequestID.current) {
                setIsLoading(false);
            }
        }
    }

    async function handleLoadNextLibraryPage() {
        if (isLoading || isLoadingNextLibraryPage || !hasNextLibraryPage) {
            return;
        }

        setIsLoadingNextLibraryPage(true);
        setError(null);

        try {
            await ensureConnected();
            const pageOffset = nextLibraryOffset.current;
            const requestID = libraryRequestID.current;
            const result = await MusicKit.getLibrarySongs(
                getLibrarySongRequestOptions(librarySort.current, pageOffset),
            );
            const nextTracks = result.items ?? [];
            if (requestID !== libraryRequestID.current) return;

            setTracks((currentTracks) =>
                appendTracksWithoutDuplicates(currentTracks, nextTracks),
            );
            nextLibraryOffset.current = pageOffset + nextTracks.length;
            setHasNextLibraryPage(
                hasNextLibraryResult(result, nextTracks.length),
            );
        } catch (e) {
            console.error(
                "Failed to fetch the next library page:",
                getErrorDetails(e),
            );
            setError(
                `Failed to load more library tracks. ${getErrorMessage(e)}`,
            );
        } finally {
            setIsLoadingNextLibraryPage(false);
        }
    }

    function handleLibrarySortChange(sort: MusicListSort) {
        void handleFetchLibrary(sort);
    }

    async function handleSearch() {
        const query = searchQuery.trim();

        if (!query) {
            setSearchResults([]);
            setSearchError(null);
            setHasNextSearchPage(false);
            nextSearchOffset.current = 0;
            activeSearchQuery.current = "";
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
        setSearchResults([]);
        setHasNextSearchPage(false);
        nextSearchOffset.current = 0;
        activeSearchQuery.current = query;

        try {
            await ensureConnected();
            const result = await MusicKit.catalogSearch(query, ["songs"], {
                limit: SEARCH_PAGE_SIZE,
                offset: 0,
            });
            const results = result.songs ?? [];
            setSearchResults(results);
            nextSearchOffset.current = results.length;
            setHasNextSearchPage(result.hasNextSongs && results.length > 0);
        } catch (e) {
            console.error("Failed to search catalog:", getErrorDetails(e));
            setSearchError(`Failed to search catalog. ${getErrorMessage(e)}`);
        } finally {
            setIsSearchLoading(false);
        }
    }

    async function handleLoadNextSearchPage() {
        const query = activeSearchQuery.current;
        if (
            !query ||
            isSearchLoading ||
            isLoadingNextSearchPage ||
            !hasNextSearchPage
        ) {
            return;
        }

        setIsLoadingNextSearchPage(true);
        setSearchError(null);

        try {
            await ensureConnected();
            const pageOffset = nextSearchOffset.current;
            const result = await MusicKit.catalogSearch(query, ["songs"], {
                limit: SEARCH_PAGE_SIZE,
                offset: pageOffset,
            });
            const nextResults = result.songs ?? [];

            setSearchResults((currentResults) =>
                appendTracksWithoutDuplicates(currentResults, nextResults),
            );
            nextSearchOffset.current = pageOffset + nextResults.length;
            setHasNextSearchPage(result.hasNextSongs && nextResults.length > 0);
        } catch (e) {
            console.error(
                "Failed to fetch the next search page:",
                getErrorDetails(e),
            );
            setSearchError(
                `Failed to load more search results. ${getErrorMessage(e)}`,
            );
        } finally {
            setIsLoadingNextSearchPage(false);
        }
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
                            onPress={() => void handleFetchLibrary()}
                            disabled={
                                isInitializing ||
                                isLoading ||
                                isLoadingNextLibraryPage ||
                                !isConnected
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
                        hasNextPage={hasNextLibraryPage}
                        isLoadingNextPage={isLoadingNextLibraryPage}
                        onLoadNextPage={handleLoadNextLibraryPage}
                        sortOptions={LIBRARY_SORT_OPTIONS}
                        onSortChange={handleLibrarySortChange}
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
                                isLoadingNextSearchPage ||
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
                        hasNextPage={hasNextSearchPage}
                        isLoadingNextPage={isLoadingNextSearchPage}
                        onLoadNextPage={handleLoadNextSearchPage}
                        showSort={false}
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

function appendTracksWithoutDuplicates(
    currentTracks: AppleMusicItem[],
    nextTracks: AppleMusicItem[],
): AppleMusicItem[] {
    const seenTrackIds = new Set(currentTracks.map((track) => track.id));

    return [
        ...currentTracks,
        ...nextTracks.filter((track) => {
            if (seenTrackIds.has(track.id)) return false;
            seenTrackIds.add(track.id);
            return true;
        }),
    ];
}

function getLibrarySongRequestOptions(sort: MusicListSort, offset: number) {
    const options = {
        limit: LIBRARY_PAGE_SIZE,
        offset,
    };

    return sort.option === "dateAdded"
        ? {
              ...options,
              sort: {
                  option: "dateAdded" as const,
                  direction: sort.direction,
              },
          }
        : options;
}

function hasNextLibraryResult(
    result: { next?: string; hasNextPage?: boolean },
    itemCount: number,
) {
    return itemCount > 0 && Boolean(result.next || result.hasNextPage);
}
