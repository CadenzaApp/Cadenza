import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";

import { GlassButton } from "@/components/ui/glass-button";
import { Text } from "@/components/ui/text";
import { AdvancedQueryBuilder } from "@/features/advanced-query-builder/AdvancedQueryBuilder";
import {
    buildAdvancedQuery,
    createGroup,
} from "@/features/advanced-query-builder/AdvancedQueryUtils";
import type {
    AdvancedGroupNode,
    AdvancedQueryJSON,
} from "@/features/advanced-query-builder/types";
import { QueryBuilder } from "@/features/query-builder/QueryBuilder";
import { queryToJSON } from "@/features/query-builder/QueryUtils";
import { ResultsSummary } from "@/features/query-builder/ResultsSummary";
import type { QueryCondition } from "@/features/query-builder/types";
import { useAllTracksFromLibrary } from "@/lib/musickit-hooks";
import { useAdvancedQueryResults, useQueryResults } from "@/lib/routes/queries";
import { useUserTags } from "@/lib/routes/tags";

type BuilderMode = "simple" | "advanced";

/**
 * The boolean query workspace. Tags used to live here behind a segmented
 * control; they are a library category now and open from the library screen.
 */
export function CadenzaScreen() {
    const { userTags, userTagsLoading, userTagsErr } = useUserTags();
    const router = useRouter();
    const [mode, setMode] = useState<BuilderMode>("simple");
    const [conditions, setConditions] = useState<QueryCondition[]>([]);
    const [advancedRoot, setAdvancedRootState] = useState<AdvancedGroupNode>(
        () => createGroup(),
    );
    const [advancedQuery, setAdvancedQuery] =
        useState<AdvancedQueryJSON | null>(null);
    const [advancedBuildError, setAdvancedBuildError] = useState<string | null>(
        null,
    );
    const {
        allLibraryTracks,
        allLibraryTracksLoading,
        allLibraryTracksErr,
        isLibraryConnected,
    } = useAllTracksFromLibrary();
    const simpleQuery = useMemo(() => queryToJSON(conditions), [conditions]);
    const candidateSongIds = useMemo(
        () => allLibraryTracks.map((track) => track.catalogId ?? track.id),
        [allLibraryTracks],
    );
    const simpleResults = useQueryResults(
        mode === "simple" ? simpleQuery : null,
        candidateSongIds,
        isLibraryConnected && !allLibraryTracksLoading && !allLibraryTracksErr,
    );
    const advancedResults = useAdvancedQueryResults(
        mode === "advanced" ? advancedQuery : null,
    );
    const tagTypes = useMemo(
        () => new Map((userTags ?? []).map((tag) => [tag.id, tag.type])),
        [userTags],
    );
    const setAdvancedRoot = useCallback(
        (update: (root: AdvancedGroupNode) => AdvancedGroupNode) => {
            setAdvancedRootState(update);
            setAdvancedQuery(null);
            setAdvancedBuildError(null);
        },
        [],
    );
    const submitAdvancedQuery = useCallback(() => {
        const result = buildAdvancedQuery(advancedRoot, tagTypes);
        if (!result.ok) {
            setAdvancedBuildError(result.error);
            setAdvancedQuery(null);
            return;
        }
        setAdvancedBuildError(null);
        setAdvancedQuery(result.query);
    }, [advancedRoot, tagTypes]);
    const matchedSongIds =
        mode === "simple"
            ? simpleResults.matchedSongIds
            : advancedResults.matchedSongIds;
    const queryResultsLoading =
        mode === "simple"
            ? simpleResults.queryResultsLoading
            : advancedResults.advancedQueryResultsLoading;
    const queryResultsErr =
        mode === "simple"
            ? simpleResults.queryResultsErr
            : advancedResults.advancedQueryResultsErr;
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
            <View className="flex-row items-center justify-between px-4 pb-2 pt-2">
                <Text className="text-lg font-bold">
                    {mode === "simple" ? "Query builder" : "Advanced query"}
                </Text>
                <GlassButton
                    className="h-10 rounded-full px-4"
                    onPress={() =>
                        setMode((current) =>
                            current === "simple" ? "advanced" : "simple",
                        )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Switch to ${mode === "simple" ? "advanced" : "simple"} query builder`}
                >
                    <Text className="text-sm font-semibold">
                        {mode === "simple" ? "Advanced" : "Simple"}
                    </Text>
                </GlassButton>
            </View>
            <ResultsSummary
                songs={matchedSongs}
                count={matchedSongIds.length}
                loading={queryResultsLoading}
                error={queryResultsErr ?? allLibraryTracksErr}
                libraryLoading={allLibraryTracksLoading}
                isLibraryConnected={isLibraryConnected}
                onNext={() => {
                    const query =
                        mode === "simple" ? simpleQuery : advancedQuery;
                    if (!query) return;
                    router.push({
                        pathname: "/query-results",
                        params: {
                            builder: mode,
                            query: JSON.stringify(query),
                        },
                    });
                }}
            />
            {mode === "simple" ? (
                <QueryBuilder
                    tags={userTags ?? []}
                    conditions={conditions}
                    setConditions={setConditions}
                />
            ) : (
                <AdvancedQueryBuilder
                    tags={userTags ?? []}
                    root={advancedRoot}
                    setRoot={setAdvancedRoot}
                    onSubmit={submitAdvancedQuery}
                    submitting={queryResultsLoading}
                    message={advancedBuildError}
                />
            )}
        </View>
    );
}
