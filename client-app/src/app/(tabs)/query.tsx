import React from "react";
import { ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { QueryBuilder } from "../../features/query-builder/QueryBuilder";
import { useAccount } from "@/lib/account";
import { useTags } from "@/lib/tags";
import { Text } from "@/components/ui/text";
import { Redirect } from "expo-router";
import { QuerySongsApiResult } from "@/features/query-builder/types";

export default function QueryScreen() {
    const { account } = useAccount();
    const { tags, loading, error } = useTags();



    function onQueryReturn(matchedSongs: QuerySongsApiResult) {
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
            <QueryBuilder tags={tags} onQueryReturn={onQueryReturn} />
        </SafeAreaView>
    );
}
