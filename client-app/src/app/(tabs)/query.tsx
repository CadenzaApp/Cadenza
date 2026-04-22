import { useState } from "react";
import { ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { QueryBuilder } from "../../features/query-builder/QueryBuilder";
import { useAccount } from "@/lib/account";
import { useTags } from "@/lib/tags";
import { Text } from "@/components/ui/text";
import { Redirect } from "expo-router";
import { MusicItem, MusicKit } from "@apple-musickit";
import QueryResults from "@/features/query-builder/QueryResults";

export default function QueryScreen() {
    const { account } = useAccount();
    const { tags, loading, error } = useTags();

    // if null, query hasn't run yet
    const [matchedSongs, setMatchedSongs] = useState<MusicItem[] | null>(null);

    async function onQueryReturn(matchedSongIds: string[]) {
        console.log("matched songs:", matchedSongIds);
        const songs = await Promise.all(
            matchedSongIds.map((id) => MusicKit.getSongInfo(id)),
        );
        setMatchedSongs(songs);
    }

    function returnToQueryBuilder() {
        setMatchedSongs(null);
    }

    if (!account) return <Redirect href="/auth?initialMode=signin" />;

    if (loading) {
        return (
            <SafeAreaView className="flex-1 bg-background items-center justify-center">
                <ActivityIndicator size="large" className="text-primary" />
            </SafeAreaView>
        );
    }

    if (error) {
        return (
            <SafeAreaView className="flex-1 bg-background items-center justify-center">
                <Text className="text-destructive text-sm">{error}</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-background">
            {matchedSongs !== null ? (
                <QueryResults
                    songs={matchedSongs}
                    onBackPress={returnToQueryBuilder}
                />
            ) : (
                <QueryBuilder tags={tags} onQueryReturn={onQueryReturn} />
            )}
        </SafeAreaView>
    );
}
