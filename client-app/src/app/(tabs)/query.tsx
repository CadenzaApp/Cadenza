import { useState } from "react";
import { ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { QueryBuilder } from "../../features/query-builder/QueryBuilder";
import { useAccount } from "@/lib/account";
import { Text } from "@/components/ui/text";
import { Redirect } from "expo-router";
import QueryResults from "@/features/query-builder/QueryResults";
import { useUserTags } from "@/lib/routes/tags";
import { useQueryResults } from "@/lib/routes/queries";
import { QueryNode } from "@/features/query-builder/types";
import { queryNodeToJSON } from "@/features/query-builder/QueryUtils";
import { useSongInfo } from "@/lib/musickit-hooks";

export default function QueryScreen() {
    const { account } = useAccount();
    const { userTags, userTagsLoading, userTagsErr } = useUserTags();

    const [root, setRoot] = useState<QueryNode | null>(null);
    const {matchedSongIds, getQueryResults, resetQuery} = useQueryResults();

    const {songInfo, songInfoLoading} = useSongInfo(matchedSongIds ?? [])
    const matchedSongs = songInfo ?? [];

    function onQuery() {
        if (root == null) return;
        getQueryResults(queryNodeToJSON(root));
    }

    if (!account) return <Redirect href="/auth?initialMode=signin" />;

    if (userTagsLoading) {
        return (
            <SafeAreaView className="flex-1 bg-background items-center justify-center">
                <ActivityIndicator size="large" className="text-primary" />
            </SafeAreaView>
        );
    }

    if (userTagsErr) {
        return (
            <SafeAreaView className="flex-1 bg-background items-center justify-center">
                <Text className="text-destructive text-sm">
                    {JSON.stringify(userTagsErr)}
                </Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-background">
            {matchedSongs.length > 0 ? (
                <QueryResults
                    songs={matchedSongs}
                    isLoading={songInfoLoading}
                    anticipatedTrackCount={matchedSongIds?.length} // Pass down the count
                    onBackPress={resetQuery}
                />
            ) : (
                <QueryBuilder tags={userTags!} onSubmit={onQuery} root={root} setRoot={setRoot}/>
            )}
        </SafeAreaView>
    );
}
