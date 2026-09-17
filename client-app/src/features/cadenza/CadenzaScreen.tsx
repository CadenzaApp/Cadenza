import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";

import { Text } from "@/components/ui/text";
import { AdvancedQueryBuilder } from "@/features/advanced-query-builder/AdvancedQueryBuilder";
import {
    buildAdvancedQuery,
    createGroup,
} from "@/features/advanced-query-builder/AdvancedQueryUtils";
import type { AdvancedGroupNode } from "@/features/advanced-query-builder/types";
import { QueryBuilder } from "@/features/query-builder/QueryBuilder";
import {
    hasSuggestedTag,
    queryToJSON,
} from "@/features/query-builder/QueryUtils";
import { ResultsSummary } from "@/features/query-builder/ResultsSummary";
import type { QueryCondition } from "@/features/query-builder/types";
import { useAllTracksFromLibrary } from "@/lib/musickit-hooks";
import { useQueryResults } from "@/lib/routes/queries";
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
    // Not wired to the query yet: the switch only holds its own state.
    const [includeSuggestedTags, setIncludeSuggestedTags] = useState(false);
    const [advancedRoot, setAdvancedRootState] = useState<AdvancedGroupNode>(
        () => createGroup(),
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
    const tagTypes = useMemo(
        () => new Map((userTags ?? []).map((tag) => [tag.id, tag.type])),
        [userTags],
    );
    const advancedBuild = useMemo(
        () => buildAdvancedQuery(advancedRoot, tagTypes),
        [advancedRoot, tagTypes],
    );
    const advancedQuery = advancedBuild.ok ? advancedBuild.query : null;
    // Both builders compile to the same wire format, so the active one just
    // decides which tree gets sent.
    const query = mode === "simple" ? simpleQuery : advancedQuery;
    const { matchedSongIds, queryResultsLoading, queryResultsErr } =
        useQueryResults(
            query,
            candidateSongIds,
            isLibraryConnected &&
                !allLibraryTracksLoading &&
                !allLibraryTracksErr,
            includeSuggestedTags,
        );
    // A suggested tag only matches while the request carries
    // consider_default_tags, so leaving one in the query after the toggle goes
    // off would quietly change what the same query returns. Clear it instead.
    const handleIncludeSuggestedTags = useCallback((next: boolean) => {
        setIncludeSuggestedTags(next);
        if (next) return;
        setConditions((current) =>
            hasSuggestedTag(current) ? [] : current,
        );
    }, []);
    const setAdvancedRoot = useCallback(
        (update: (root: AdvancedGroupNode) => AdvancedGroupNode) => {
            setAdvancedRootState(update);
        },
        [],
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
            <ResultsSummary
                songs={matchedSongs}
                count={matchedSongIds.length}
                loading={queryResultsLoading}
                error={queryResultsErr ?? allLibraryTracksErr}
                libraryLoading={allLibraryTracksLoading}
                isLibraryConnected={isLibraryConnected}
                builderToggleLabel={mode === "simple" ? "Advanced" : "Simple"}
                onBuilderToggle={() =>
                    setMode((current) =>
                        current === "simple" ? "advanced" : "simple",
                    )
                }
                onNext={() => {
                    if (!query) return;
                    router.push({
                        pathname: "/query-results",
                        params: {
                            query: JSON.stringify(query),
                            suggested: includeSuggestedTags ? "1" : "",
                        },
                    });
                }}
            />
            {mode === "simple" ? (
                <QueryBuilder
                    tags={userTags ?? []}
                    conditions={conditions}
                    setConditions={setConditions}
                    includeSuggestedTags={includeSuggestedTags}
                    onIncludeSuggestedTagsChange={handleIncludeSuggestedTags}
                />
            ) : (
                <AdvancedQueryBuilder
                    tags={userTags ?? []}
                    root={advancedRoot}
                    setRoot={setAdvancedRoot}
                    message={advancedBuild.ok ? null : advancedBuild.error}
                />
            )}
        </View>
    );
}
