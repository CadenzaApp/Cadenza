import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, BackHandler, View } from "react-native";
import { useFocusEffect } from "expo-router";
import Animated, {
    FadeInLeft,
    FadeInRight,
    FadeOutLeft,
    FadeOutRight,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { QueryBuilder } from "@/features/query-builder/QueryBuilder";
import QueryResults from "@/features/query-builder/QueryResults";
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
    const [conditions, setConditions] = useState<QueryCondition[]>([]);
    const [showFullResults, setShowFullResults] = useState(false);
    const showBuilder = useCallback(() => setShowFullResults(false), []);
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

    useFocusEffect(
        useCallback(() => {
            if (!showFullResults) return;
            const subscription = BackHandler.addEventListener(
                "hardwareBackPress",
                () => {
                    showBuilder();
                    return true;
                },
            );
            return () => subscription.remove();
        }, [showBuilder, showFullResults]),
    );

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
            {showFullResults ? (
                <Animated.View
                    key="query-results"
                    className="flex-1"
                    entering={FadeInRight.duration(240)}
                    exiting={FadeOutRight.duration(180)}
                >
                    <QueryResults
                        songs={matchedSongs}
                        isLoading={
                            queryResultsLoading || allLibraryTracksLoading
                        }
                        error={queryResultsErr ?? allLibraryTracksErr}
                        anticipatedTrackCount={matchedSongIds.length}
                        onBackPress={showBuilder}
                    />
                </Animated.View>
            ) : (
                <Animated.View
                    key="query-builder"
                    className="flex-1"
                    entering={FadeInLeft.duration(240)}
                    exiting={FadeOutLeft.duration(180)}
                >
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
                        onNext={() => setShowFullResults(true)}
                    />
                </Animated.View>
            )}
        </View>
    );
}
