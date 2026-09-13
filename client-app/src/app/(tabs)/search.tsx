import type { ArtistItem } from "@apple-musickit";
import { MusicKit } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useLayoutEffect, useState } from "react";
import { Alert, Keyboard, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MusicList } from "@/components/custom/music-list";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import type { RecentSearch } from "@/features/search/recent-searches";
import { useRecentSearches } from "@/features/search/recent-searches";
import { SearchArtists } from "@/features/search/search-artists";
import { SearchField } from "@/features/search/search-field";
import { SearchLanding } from "@/features/search/search-landing";
import { SearchRecents } from "@/features/search/search-recents";
import type { SearchScope } from "@/features/search/search-scope";
import { SearchScopeToggle } from "@/features/search/search-scope";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { getErrorMessage } from "@/lib/error-utils";
import {
    useCatalogArtistSearch,
    useCatalogSongSearch,
    useLibraryArtistSearch,
    useLibrarySongSearch,
} from "@/lib/musickit-hooks";
import { usePlaybackCommands } from "@/lib/playback";

const DEFAULT_MULTI_SELECT_CONFIG = {} as const;

/**
 * Two states, the way Apple Music's Search tab works. Unfocused is a browse
 * page with the title rail above it. Tapping the field drops the rail and
 * gives you the field, a scope switch, and your recents.
 */
export default function SearchScreen() {
    const [term, setTerm] = useState("");
    const [focused, setFocused] = useState(false);
    const [scope, setScope] = useState<SearchScope>("catalog");
    const [hasSearched, setHasSearched] = useState(false);
    // The term the last submit ran with. `term` tracks the field and changes on
    // every keystroke; the artist hooks key off this one so they do not refetch
    // while the user is still typing.
    const [submittedTerm, setSubmittedTerm] = useState("");
    const navigation = useNavigation();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const { isConnected, ensureConnected } = useAppleMusic();
    const { togglePlayback } = usePlaybackCommands();
    const { recents, recordQuery, recordSong, removeRecent, clearRecents } =
        useRecentSearches();
    const catalog = useCatalogSongSearch(isConnected);
    const library = useLibrarySongSearch(isConnected);
    const catalogArtists = useCatalogArtistSearch(
        submittedTerm,
        isConnected && scope === "catalog",
    );
    const libraryArtists = useLibraryArtistSearch(
        submittedTerm,
        isConnected && scope === "library",
    );

    // The rail is the navigator's header, so the screen turns it off rather
    // than drawing around it. It owes itself the top inset while it is gone.
    useLayoutEffect(() => {
        navigation.setOptions({ headerShown: !focused });
        return () => navigation.setOptions({ headerShown: true });
    }, [navigation, focused]);

    const results =
        scope === "catalog"
            ? catalog.searchResults
            : library.librarySearchResults;
    const resultsLoading =
        scope === "catalog"
            ? catalog.searchCatalogLoading
            : library.librarySearchLoading;
    const resultsErr =
        scope === "catalog"
            ? catalog.searchCatalogErr
            : library.librarySearchErr;
    const artists =
        scope === "catalog" ? catalogArtists.artists : libraryArtists.artists;
    const artistsLoading =
        scope === "catalog"
            ? catalogArtists.artistsLoading
            : libraryArtists.artistsLoading;

    async function runSearch(text: string, nextScope: SearchScope = scope) {
        const query = text.trim();
        if (!query) return;

        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from Account before searching.",
            );
            return;
        }

        await ensureConnected();
        setTerm(query);
        setSubmittedTerm(query);
        setHasSearched(true);
        if (nextScope === "catalog") catalog.searchCatalog(query);
        else library.searchLibrary(query);
        recordQuery(query);
    }

    function changeScope(nextScope: SearchScope) {
        setScope(nextScope);
        if (hasSearched) void runSearch(term, nextScope);
    }

    /** Empties the field without leaving the focused state. */
    function clearTerm() {
        setTerm("");
        setSubmittedTerm("");
        setHasSearched(false);
        catalog.clearSearchCatalog();
        library.clearLibrarySearch();
    }

    function exitSearch() {
        clearTerm();
        setFocused(false);
        Keyboard.dismiss();
    }

    function openArtist(artist: ArtistItem) {
        // Catalog only; ArtistRail already disables a row without a catalog id.
        if (!artist.catalogId) return;
        router.push({
            pathname: "/artist/[id]",
            params: { id: artist.catalogId, name: artist.name },
        });
    }

    // A recent row stores only what it draws, so playing one means fetching
    // the real track first. One-off and not reusable, thus imperative.
    async function playRecentSong(
        entry: Extract<RecentSearch, { kind: "song" }>,
    ) {
        if (!isConnected) return;
        await ensureConnected();
        const [song] = await MusicKit.getSongInfo([entry.songId]);
        if (song) await togglePlayback(song);
    }

    if (!focused) {
        return (
            <View className="flex-1 bg-background">
                <View className="mb-3 mt-2 flex-row items-center px-5">
                    {/* The field is inert here: a tap switches states rather
                        than opening the keyboard under the old layout. */}
                    <Pressable
                        accessibilityRole="search"
                        accessibilityLabel="Search Apple Music"
                        onPress={() => setFocused(true)}
                        className="flex-1 flex-row active:opacity-80"
                    >
                        <View pointerEvents="none" className="flex-1 flex-row">
                            <SearchField
                                value=""
                                onChangeText={() => {}}
                                onSubmit={() => {}}
                                onClear={() => {}}
                                editable={false}
                            />
                        </View>
                    </Pressable>
                </View>

                <SearchLanding />
            </View>
        );
    }

    return (
        <View
            className="flex-1 bg-background"
            style={{ paddingTop: insets.top }}
        >
            <View className="mb-3 mt-2 flex-row items-center gap-3 px-5">
                <SearchField
                    value={term}
                    onChangeText={setTerm}
                    onSubmit={() => void runSearch(term)}
                    onClear={clearTerm}
                    autoFocus
                />
                <GlassIconButton
                    accessibilityLabel="Close search"
                    onPress={exitSearch}
                >
                    <Ionicons name="close" size={20} color={colors.text} />
                </GlassIconButton>
            </View>

            <View className="mb-2">
                <SearchScopeToggle scope={scope} onChange={changeScope} />
            </View>

            {resultsErr ? (
                <Text className="my-2 px-5 text-center text-destructive">
                    {getErrorMessage(resultsErr)}
                </Text>
            ) : null}

            {hasSearched ? (
                <MusicList
                    tracks={results}
                    isLoading={resultsLoading}
                    header={
                        <SearchArtists
                            artists={artists}
                            isLoading={artistsLoading}
                            onSelect={openArtist}
                        />
                    }
                    onTrackPressOverride={(track) => {
                        recordSong(track);
                        return togglePlayback(track);
                    }}
                    pagination={
                        scope === "catalog"
                            ? {
                                  hasNextPage: catalog.hasNextSearchPage,
                                  isLoadingNextPage:
                                      catalog.isLoadingNextSearchPage,
                                  onLoadNextPage: catalog.loadNextSearchPage,
                              }
                            : {
                                  hasNextPage: library.hasNextLibrarySearchPage,
                                  isLoadingNextPage:
                                      library.isLoadingNextLibrarySearchPage,
                                  onLoadNextPage:
                                      library.loadNextLibrarySearchPage,
                              }
                    }
                    multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                    fullBleedRows
                />
            ) : (
                <SearchRecents
                    recents={recents}
                    onSelectQuery={(text) => void runSearch(text)}
                    onSelectSong={(entry) => void playRecentSong(entry)}
                    onRemoveRecent={removeRecent}
                    onClearRecents={clearRecents}
                />
            )}
        </View>
    );
}
