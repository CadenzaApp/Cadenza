import { useState } from "react";
import { ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { QueryBuilder } from "../../features/query-builder/QueryBuilder";
import { useAccount } from "@/lib/account";
import { Text } from "@/components/ui/text";
import { Redirect } from "expo-router";
import QueryResults from "@/features/query-builder/QueryResults";
import { useTags } from "@/lib/routes/tags";
import { useSongInfo } from "@/lib/musickit-hooks";

export default function QueryScreen() {
    const { account } = useAccount();
    const { tagsWithMeta, tagsLoading, tagsErr } = useTags();
    const tags = tagsWithMeta?.map((item) => item.tag);

    const [matchedSongIds, setMatchedSongIds] = useState<string[] | null>(null);
    const {
        songInfo: matchedSongs,
        songInfoLoading: isFetchingMetadata,
        songInfoErr,
    } = useSongInfo(matchedSongIds);

    // Add state to track how many songs we expect to load
    const [anticipatedCount, setAnticipatedCount] = useState<
        number | undefined
    >(undefined);

    function onQueryReturn(songIds: string[]) {
        console.log("matched songs:", songIds);

        // Instantly store the known length before we start the network fetch
        setAnticipatedCount(songIds.length);
        setMatchedSongIds(songIds);
    }

    function returnToQueryBuilder() {
        setMatchedSongIds(null);
    }

    if (!account) return <Redirect href="/auth?initialMode=signin" />;

    if (tagsLoading) {
        return (
            <SafeAreaView className="flex-1 bg-background items-center justify-center">
                <ActivityIndicator size="large" className="text-primary" />
            </SafeAreaView>
        );
    }

    if (tagsErr) {
        return (
            <SafeAreaView className="flex-1 bg-background items-center justify-center">
                <Text className="text-destructive text-sm">
                    {JSON.stringify(tagsErr)}
                </Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-background">
            {matchedSongIds !== null ? (
                <QueryResults
                    songs={matchedSongs}
                    isLoading={isFetchingMetadata}
                    anticipatedTrackCount={anticipatedCount} // Pass down the count
                    error={songInfoErr}
                    onBackPress={returnToQueryBuilder}
                />
            ) : (
                <QueryBuilder tags={tags!} onQueryReturn={onQueryReturn} />
            )}
        </SafeAreaView>
    );
}
