import { useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { TagGenerationNotice } from "@/components/custom/tag-generation-notice";
import { Text } from "@/components/ui/text";
import { QueryBuilder } from "@/features/query-builder/QueryBuilder";
import QueryResults from "@/features/query-builder/QueryResults";
import { queryNodeToJSON } from "@/features/query-builder/QueryUtils";
import type { QueryNode } from "@/features/query-builder/types";
import { useSongInfo } from "@/lib/musickit-hooks";
import { useQueryResults } from "@/lib/routes/queries";
import { useUserTags } from "@/lib/routes/tags";

/**
 * The boolean query workspace. Tags used to live here behind a segmented
 * control; they are a library category now and open from the library screen.
 */
export function CadenzaScreen() {
    const [root, setRoot] = useState<QueryNode | null>(null);
    const { userTags, userTagsLoading, userTagsErr } = useUserTags();
    const {
        matchedSongIds,
        getQueryResults,
        queryResultsLoading,
        queryResultsErr,
        resetQuery,
    } = useQueryResults();
    const { songInfo, songInfoLoading } = useSongInfo(matchedSongIds ?? []);

    function handleQuery() {
        if (!root) return;
        void getQueryResults(queryNodeToJSON(root));
    }

    if (userTagsLoading) {
        return (
            <View className="flex-1 items-center justify-center bg-background">
                <ActivityIndicator size="large" />
            </View>
        );
    }

    if (userTagsErr) {
        return (
            <View className="flex-1 items-center justify-center bg-background px-6">
                <Text className="text-center text-sm text-destructive">
                    {JSON.stringify(userTagsErr)}
                </Text>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-background">
            <TagGenerationNotice className="mx-4 mt-4" />
            {matchedSongIds !== undefined ? (
                <QueryResults
                    songs={songInfo ?? []}
                    isLoading={queryResultsLoading || songInfoLoading}
                    error={queryResultsErr}
                    anticipatedTrackCount={matchedSongIds.length}
                    onBackPress={resetQuery}
                />
            ) : (
                <QueryBuilder
                    tags={userTags ?? []}
                    onSubmit={handleQuery}
                    root={root}
                    setRoot={setRoot}
                />
            )}
        </View>
    );
}
