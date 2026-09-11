import { useState } from "react";
import { Platform, View } from "react-native";

import {
    MusicList,
    MUSIC_LIST_SORT_OPTIONS,
    type MusicListSort,
} from "@/components/custom/music-list";
import { Text } from "@/components/ui/text";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { getErrorMessage } from "@/lib/error-utils";
import { useTracksFromLibrary } from "@/lib/musickit-hooks";

const DEFAULT_LIBRARY_SORT: MusicListSort = {
    option: Platform.OS === "ios" ? "dateAdded" : "title",
    direction: Platform.OS === "ios" ? "descending" : "ascending",
};
const LIBRARY_SORT_OPTIONS =
    Platform.OS === "ios" ? MUSIC_LIST_SORT_OPTIONS : ([] as const);
const DEFAULT_MULTI_SELECT_CONFIG = {} as const;

export default function LibraryScreen() {
    const [librarySort, setLibrarySort] =
        useState<MusicListSort>(DEFAULT_LIBRARY_SORT);
    const { isConnected } = useAppleMusic();
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

    return (
        <View className="flex-1 bg-background">
            {tracksErr ? (
                <Text className="my-2 px-6 text-center text-destructive">
                    {getErrorMessage(tracksErr)}
                </Text>
            ) : null}

            <MusicList
                tracks={tracks}
                isLoading={tracksLoading}
                pagination={{
                    hasNextPage: hasNextLibraryPage,
                    isLoadingNextPage: tracksLoadingNextPage,
                    onLoadNextPage: loadNextLibraryPage,
                }}
                sorting={{
                    options: LIBRARY_SORT_OPTIONS,
                    value: librarySort,
                    strategy: "remote",
                    onChange: setLibrarySort,
                }}
                multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                fullBleedRows
            />
        </View>
    );
}
