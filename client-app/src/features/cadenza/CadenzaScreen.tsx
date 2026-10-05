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
import { useTracksForSongIds } from "@/lib/musickit-hooks";
import { describeQuery, positiveQueryTagNames } from "@/lib/query-json";
import { useQueryResults } from "@/lib/routes/queries";
import {
    useActivityTagIdsInQuery,
    useActivityTags,
    useUserTags,
} from "@/lib/routes/tags";
import { useScoreQueryTags } from "@/lib/tag-scores";
import type { Tag } from "@/lib/types";

type BuilderMode = "simple" | "advanced";

const EMPTY_TAGS: Tag[] = [];

/**
 * The boolean query workspace. Tags used to live here behind a segmented
 * control; they are a library category now and open from the library screen.
 */
export function CadenzaScreen() {
    const { userTags, userTagsMeta, userTagsLoading, userTagsErr } =
        useUserTags();
    // offered by the advanced builder only; the simple builder's palette is
    // the user's own tags
    const { activityTags } = useActivityTags();
    const router = useRouter();
    const scoreQueryTags = useScoreQueryTags();
    const [mode, setMode] = useState<BuilderMode>("simple");
    const [conditions, setConditions] = useState<QueryCondition[]>([]);
    // Not wired to the query yet: the switch only holds its own state.
    const [includeSuggestedTags, setIncludeSuggestedTags] = useState(false);
    const [advancedRoot, setAdvancedRootState] = useState<AdvancedGroupNode>(
        () => createGroup(),
    );
    const simpleQuery = useMemo(() => queryToJSON(conditions), [conditions]);
    const tagTypes = useMemo(
        () =>
            new Map(
                [...(userTags ?? []), ...(activityTags ?? [])].map((tag) => [
                    tag.id,
                    tag.type,
                ]),
            ),
        [userTags, activityTags],
    );
    const advancedBuild = useMemo(
        () => buildAdvancedQuery(advancedRoot, tagTypes),
        [advancedRoot, tagTypes],
    );
    const advancedQuery = advancedBuild.ok ? advancedBuild.query : null;
    // Both builders compile to the same wire format, so the active one just
    // decides which tree gets sent.
    const query = mode === "simple" ? simpleQuery : advancedQuery;
    const relevantTagNames = useMemo(() => {
        if (!query) return [];
        const tags =
            mode === "simple"
                ? [...(userTags ?? []), ...conditionTags(conditions)]
                : (userTags ?? []);
        return positiveQueryTagNames(query, tags);
    }, [conditions, mode, query, userTags]);
    const { matchedSongIds, queryResultsLoading, queryResultsErr } =
        useQueryResults(query, includeSuggestedTags);
    const activityTagIds = useActivityTagIdsInQuery(query);
    // A suggested tag only matches while the request carries
    // consider_default_tags, so leaving one in the query after the toggle goes
    // off would quietly change what the same query returns. Clear it instead.
    const handleIncludeSuggestedTags = useCallback((next: boolean) => {
        setIncludeSuggestedTags(next);
        if (next) return;
        setConditions((current) => (hasSuggestedTag(current) ? [] : current));
    }, []);
    const setAdvancedRoot = useCallback(
        (update: (root: AdvancedGroupNode) => AdvancedGroupNode) => {
            setAdvancedRootState(update);
        },
        [],
    );
    const {
        tracks: matchedSongs,
        tracksLoading,
        tracksErr,
        isLibraryConnected,
    } = useTracksForSongIds(matchedSongIds);

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
                error={queryResultsErr ?? tracksErr}
                libraryLoading={tracksLoading}
                isLibraryConnected={isLibraryConnected}
                builderToggleLabel={mode === "simple" ? "Advanced" : "Simple"}
                onBuilderToggle={() =>
                    setMode((current) =>
                        current === "simple" ? "advanced" : "simple",
                    )
                }
                onNext={() => {
                    if (!query) return;
                    // opening the full results is the user committing to the
                    // query, so that is when its tags score. suggested tags are
                    // not in userTags, so the simple builder's own tags come too
                    void scoreQueryTags(query, [
                        ...(userTags ?? []),
                        ...(mode === "simple" ? conditionTags(conditions) : []),
                    ]);
                    router.push({
                        pathname: "/query-results",
                        params: {
                            query: JSON.stringify(query),
                            suggested: includeSuggestedTags ? "1" : "",
                            relevantTags: JSON.stringify(relevantTagNames),
                            // what the query is called in the analytics
                            // ranking once a song plays from it
                            name: describeQuery(query, [
                                ...(userTags ?? []),
                                ...(activityTags ?? []),
                                ...conditionTags(conditions),
                            ]),
                        },
                    });
                }}
                mostRelevantTags={relevantTagNames}
                activityTagIds={activityTagIds}
            />
            {mode === "simple" ? (
                <QueryBuilder
                    tags={userTags ?? []}
                    tagMetadata={userTagsMeta}
                    conditions={conditions}
                    setConditions={setConditions}
                    includeSuggestedTags={includeSuggestedTags}
                    onIncludeSuggestedTagsChange={handleIncludeSuggestedTags}
                />
            ) : (
                <AdvancedQueryBuilder
                    tags={userTags ?? []}
                    activityTags={activityTags ?? EMPTY_TAGS}
                    root={advancedRoot}
                    setRoot={setAdvancedRoot}
                    message={advancedBuild.ok ? null : advancedBuild.error}
                />
            )}
        </View>
    );
}

/** Every tag in the simple builder's conditions, suggested ones included. */
function conditionTags(conditions: readonly QueryCondition[]): Tag[] {
    return conditions.flatMap((condition) =>
        condition.kind === "tag"
            ? [condition.tag]
            : condition.members.map((member) => member.tag),
    );
}
