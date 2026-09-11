import { useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { Text } from "@/components/ui/text";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryBuilder } from "@/features/query-builder/QueryBuilder";
import QueryResults from "@/features/query-builder/QueryResults";
import { queryNodeToJSON } from "@/features/query-builder/QueryUtils";
import type { QueryNode } from "@/features/query-builder/types";
import { useSongInfo } from "@/lib/musickit-hooks";
import { useQueryResults } from "@/lib/routes/queries";
import { useUserTags } from "@/lib/routes/tags";

import { TagsView } from "./TagsView";

type CadenzaView = "query" | "tags";

export function CadenzaScreen() {
    const [activeView, setActiveView] = useState<CadenzaView>("query");
    const [root, setRoot] = useState<QueryNode | null>(null);
    const { userTags, userTagsMeta, userTagsLoading, userTagsErr } =
        useUserTags();
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

    function handleViewChange(value: string) {
        setActiveView(value as CadenzaView);
    }

    return (
        <Tabs
            value={activeView}
            onValueChange={handleViewChange}
            className="flex-1 gap-0 bg-background"
        >
            <View className="px-6 pt-3 pb-2">
                <TabsList className="w-full flex-row">
                    <TabsTrigger value="query" className="flex-1">
                        <Text>Query</Text>
                    </TabsTrigger>
                    <TabsTrigger value="tags" className="flex-1">
                        <Text>Tags</Text>
                    </TabsTrigger>
                </TabsList>
            </View>

            <TabsContent value="query" className="flex-1">
                {userTagsLoading ? (
                    <View className="flex-1 items-center justify-center">
                        <ActivityIndicator size="large" />
                    </View>
                ) : userTagsErr ? (
                    <View className="flex-1 items-center justify-center px-6">
                        <Text className="text-center text-sm text-destructive">
                            {JSON.stringify(userTagsErr)}
                        </Text>
                    </View>
                ) : matchedSongIds !== undefined ? (
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
            </TabsContent>

            <TabsContent value="tags" className="flex-1">
                <TagsView
                    tags={userTags}
                    metadata={userTagsMeta}
                    isLoading={userTagsLoading}
                    error={userTagsErr}
                />
            </TabsContent>
        </Tabs>
    );
}
