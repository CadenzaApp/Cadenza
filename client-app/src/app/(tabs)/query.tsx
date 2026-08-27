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

    const [matchedSongs, setMatchedSongs] = useState<MusicItem[] | null>(null);
    const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);

    // Add state to track how many songs we expect to load
    const [anticipatedCount, setAnticipatedCount] = useState<
        number | undefined
    >(undefined);

    async function onQueryReturn(matchedSongIds: string[]) {
        console.log("matched songs:", matchedSongIds);

        // Instantly store the known length before we start the network fetch
        setAnticipatedCount(matchedSongIds.length);

        setMatchedSongs([]);
        setIsFetchingMetadata(true);

        try {
            const songs = await MusicKit.getSongInfo(matchedSongIds);
            setMatchedSongs(songs);
        } catch (e) {
            console.error("Failed to fetch song metadata", e);
            setMatchedSongs([]);
        } finally {
            setIsFetchingMetadata(false);
        }
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
                    isLoading={isFetchingMetadata}
                    anticipatedTrackCount={anticipatedCount} // Pass down the count
                    onBackPress={returnToQueryBuilder}
                />
            ) : (
                <QueryBuilder tags={tags} onQueryReturn={onQueryReturn} />
            )}
        </SafeAreaView>
    );
}
