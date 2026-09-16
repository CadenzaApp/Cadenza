import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, Stack } from "expo-router";

import { Text } from "@/components/ui/text";
import { AdvancedQueryBuilder } from "@/features/advanced-query-builder/AdvancedQueryBuilder";
import {
    buildAdvancedQuery,
    createGroup,
} from "@/features/advanced-query-builder/AdvancedQueryUtils";
import { AdvancedGroupNode } from "@/features/advanced-query-builder/types";
import QueryResults from "@/features/query-builder/QueryResults";
import { useAccount } from "@/lib/account";
import { useSongInfo } from "@/lib/musickit-hooks";
import { useAdvancedQueryResults } from "@/lib/routes/queries";
import { useUserTags } from "@/lib/routes/tags";

export default function AdvancedQueryScreen() {
    const { account } = useAccount();
    const { userTags, userTagsLoading, userTagsErr } = useUserTags();

    const [root, setRootState] = useState<AdvancedGroupNode>(() =>
        createGroup(),
    );
    const [buildErr, setBuildErr] = useState<string | null>(null);

    const {
        matchedSongIds,
        getAdvancedQueryResults,
        advancedQueryResultsLoading,
        advancedQueryResultsErr,
        resetAdvancedQuery,
    } = useAdvancedQueryResults();

    const { songInfo, songInfoLoading } = useSongInfo(matchedSongIds ?? []);

    const tagTypes = useMemo(
        () => new Map((userTags ?? []).map((tag) => [tag.id, tag.type])),
        [userTags],
    );

    // Any edit clears the last message, so "no matches" or an error never
    // describes a query the user has since changed.
    const setRoot = useCallback(
        (update: (root: AdvancedGroupNode) => AdvancedGroupNode) => {
            setRootState(update);
            setBuildErr(null);
            resetAdvancedQuery();
        },
        [resetAdvancedQuery],
    );

    async function onQuery() {
        const result = buildAdvancedQuery(root, tagTypes);
        if (!result.ok) {
            setBuildErr(result.error);
            return;
        }
        setBuildErr(null);
        try {
            await getAdvancedQueryResults(result.query);
        } catch {
            // surfaced through advancedQueryResultsErr
        }
    }

    if (!account) return <Redirect href="/auth?initialMode=signin" />;

    const header = <Stack.Screen options={{ title: "Advanced query" }} />;

    if (userTagsLoading) {
        return (
            <View className="flex-1 bg-background items-center justify-center">
                {header}
                <ActivityIndicator size="large" className="text-primary" />
            </View>
        );
    }

    if (userTagsErr) {
        return (
            <View className="flex-1 bg-background items-center justify-center">
                {header}
                <Text className="text-destructive text-sm">
                    {JSON.stringify(userTagsErr)}
                </Text>
            </View>
        );
    }

    let message = buildErr;
    if (!message && advancedQueryResultsErr) {
        message =
            (advancedQueryResultsErr as { message?: string }).message ??
            "Something went wrong running this query.";
    } else if (!message && matchedSongIds?.length === 0) {
        message = "No songs match these filters.";
    }

    return (
        <View className="flex-1 bg-background">
            {header}
            {matchedSongIds && matchedSongIds.length > 0 ? (
                <QueryResults
                    songs={songInfo ?? []}
                    isLoading={songInfoLoading}
                    anticipatedTrackCount={matchedSongIds.length}
                    onBackPress={resetAdvancedQuery}
                />
            ) : (
                <AdvancedQueryBuilder
                    tags={userTags ?? []}
                    root={root}
                    setRoot={setRoot}
                    onSubmit={onQuery}
                    submitting={advancedQueryResultsLoading}
                    message={message}
                />
            )}
        </View>
    );
}
