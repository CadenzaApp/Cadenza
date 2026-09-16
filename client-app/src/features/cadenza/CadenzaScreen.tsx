import { useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";

import { Text } from "@/components/ui/text";
import { QueryBuilder } from "@/features/query-builder/QueryBuilder";
import { queryToJSON } from "@/features/query-builder/QueryUtils";
import type { QueryCondition } from "@/features/query-builder/types";
import { useAllTracksFromLibrary } from "@/lib/musickit-hooks";
import { useQueryResults } from "@/lib/routes/queries";
import { useUserTags } from "@/lib/routes/tags";

/**
 * The boolean query workspace. Tags used to live here behind a segmented
 * control; they are a library category now and open from the library screen.
 */
export function CadenzaScreen() {
    const { userTags, userTagsLoading, userTagsErr } = useUserTags();
    const router = useRouter();
    const [conditions, setConditions] = useState<QueryCondition[]>([]);
    const {
        allLibraryTracks,
        allLibraryTracksLoading,
        allLibraryTracksErr,
        isLibraryConnected,
    } = useAllTracksFromLibrary();
    const query = useMemo(() => queryToJSON(conditions), [conditions]);
    const candidateSongIds = useMemo(
        () => allLibraryTracks.map((track) => track.catalogId ?? track.id),
        [allLibraryTracks],
    );
    const { matchedSongIds, queryResultsLoading, queryResultsErr } =
        useQueryResults(
            query,
            candidateSongIds,
            isLibraryConnected &&
                !allLibraryTracksLoading &&
                !allLibraryTracksErr,
        );
    const matchedSongs = useMemo(() => {
        const tracksByQueryId = new Map(
            allLibraryTracks.map((track) => [
                track.catalogId ?? track.id,
                track,
            ]),
        );
        return matchedSongIds.flatMap((id) => {
            const track = tracksByQueryId.get(id);
            return track ? [track] : [];
        });
    }, [allLibraryTracks, matchedSongIds]);

    if (userTagsLoading) {
        return (
            <View className="flex-1 items-center justify-center bg-background">
                <ActivityIndicator size="large" className="text-primary" />
            </View>
        );
    }

    if (userTagsErr) {
        return (
            <View className="flex-1 items-center justify-center bg-background px-6">
                <Text className="text-center text-sm text-destructive">
                    Your tags could not be loaded.
                </Text>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-background">
            <QueryBuilder
                tags={userTags ?? []}
                conditions={conditions}
                setConditions={setConditions}
                songs={matchedSongs}
                resultCount={matchedSongIds.length}
                resultsLoading={queryResultsLoading}
                resultsError={queryResultsErr ?? allLibraryTracksErr}
                libraryLoading={allLibraryTracksLoading}
                isLibraryConnected={isLibraryConnected}
                onNext={() => {
                    if (!query) return;
                    router.push({
                        pathname: "/query-results",
                        params: { query: JSON.stringify(query) },
                    });
                }}
            />
        </View>
    );
}
