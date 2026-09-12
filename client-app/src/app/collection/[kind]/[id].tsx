import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { MusicList } from "@/components/custom/music-list";
import { SheetScreen } from "@/components/ui/sheet-screen";
import { Text } from "@/components/ui/text";
import { getErrorMessage } from "@/lib/error-utils";
import { useCollectionSongs } from "@/lib/musickit-hooks";

import type { LibraryCollectionKind } from "@/lib/musickit-hooks";

const DEFAULT_MULTI_SELECT_CONFIG = {} as const;

/**
 * The songs inside one library album or playlist. Both kinds render the same
 * way, so the kind is a route param rather than two screens. Opened from the
 * album or playlist sheet, so it is a sheet too.
 */
export default function CollectionDetailScreen() {
    const { kind, id, title } = useLocalSearchParams<{
        kind: LibraryCollectionKind;
        id: string;
        title?: string;
    }>();
    const {
        tracks,
        tracksLoading,
        tracksLoadingNextPage,
        loadNextCollectionPage,
        hasNextCollectionPage,
        tracksErr,
    } = useCollectionSongs(kind, id);

    return (
        <SheetScreen
            title={title ?? (kind === "playlist" ? "Playlist" : "Album")}
        >
            {tracksErr ? (
                <Text className="my-2 px-6 text-center text-destructive">
                    {getErrorMessage(tracksErr)}
                </Text>
            ) : null}

            <View className="flex-1">
                <MusicList
                    tracks={tracks}
                    isLoading={tracksLoading}
                    pagination={{
                        hasNextPage: hasNextCollectionPage,
                        isLoadingNextPage: tracksLoadingNextPage,
                        onLoadNextPage: loadNextCollectionPage,
                    }}
                    multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                    fullBleedRows
                />
            </View>
        </SheetScreen>
    );
}
