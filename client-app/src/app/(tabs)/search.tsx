import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Alert, View } from "react-native";

import { MusicList } from "@/components/custom/music-list";
import { Button } from "@/components/ui/button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { getErrorMessage } from "@/lib/error-utils";
import { useCatalogSongSearch } from "@/lib/musickit-hooks";

const DEFAULT_MULTI_SELECT_CONFIG = {} as const;
const SEARCH_FIELD_RADIUS = 22;

export default function SearchScreen() {
    const [searchQuery, setSearchQuery] = useState("");
    const { isInitializing, isConnected, ensureConnected } = useAppleMusic();
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
                "Connect Apple Music from Account before searching.",
            );
            return;
        }

        await ensureConnected();
        searchCatalog(query);
    }

    return (
        <View className="flex-1 bg-background pt-3">
            <View className="mb-4 flex-row items-center gap-2 px-6">
                {/* The field is the glass, not the input, so the blur clips to
                    the pill and the text input stays transparent over it. */}
                <GlassSurface
                    variant="clear"
                    className="mr-2 flex-1"
                    style={{
                        borderRadius: SEARCH_FIELD_RADIUS,
                        overflow: "hidden",
                    }}
                >
                    <Input
                        className="h-11 w-full border-0 bg-transparent pl-5 shadow-none"
                        placeholder="Search Apple Music..."
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        onSubmitEditing={() => void handleSearch()}
                        returnKeyType="search"
                        editable={!searchCatalogLoading}
                    />
                </GlassSurface>
                <Button
                    size="icon"
                    className="h-11 w-11 rounded-full"
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

            {searchCatalogErr ? (
                <Text className="my-2 px-6 text-center text-destructive">
                    {getErrorMessage(searchCatalogErr)}
                </Text>
            ) : null}

            <MusicList
                tracks={searchResults}
                isLoading={searchCatalogLoading}
                pagination={{
                    hasNextPage: hasNextSearchPage,
                    isLoadingNextPage: isLoadingNextSearchPage,
                    onLoadNextPage: loadNextSearchPage,
                }}
                multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                fullBleedRows
            />
        </View>
    );
}
