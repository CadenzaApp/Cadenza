import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import type { MusicItem } from "@apple-musickit";

import { MusicList } from "@/components/custom/music-list";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "nativewind";

export function ResultsSummary({
    songs,
    count,
    loading,
    error,
    libraryLoading,
    isLibraryConnected,
    onNext,
}: {
    songs: MusicItem[];
    count: number;
    loading: boolean;
    error?: unknown;
    libraryLoading: boolean;
    isLibraryConnected: boolean;
    onNext: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const canAdvance = count > 0 && !error;
    const noun = count === 1 ? "song" : "songs";
    const previewRowCount = Math.max(1, Math.min(count || songs.length, 3));
    const previewHeight = previewRowCount * 68;

    return (
        <View className="border-b border-border bg-background px-2 pb-2 pt-1">
            <View className="flex-row items-center gap-3">
                <Pressable
                    className="min-h-11 flex-1 flex-row items-center rounded-xl border border-border bg-card px-3"
                    onPress={() => setExpanded((value) => !value)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${count} ${noun} found`}
                    accessibilityHint={
                        expanded ? "Collapses results" : "Expands results"
                    }
                >
                    <Ionicons
                        name="musical-notes-outline"
                        size={19}
                        color={theme.primary}
                    />
                    <Text className="ml-2.5 flex-1 text-base font-semibold">
                        {libraryLoading || loading
                            ? "Finding songs..."
                            : `${count} ${noun} found`}
                    </Text>
                    {libraryLoading || loading ? (
                        <ActivityIndicator color={theme.primary} />
                    ) : (
                        <Ionicons
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={20}
                            color={theme.mutedForeground}
                        />
                    )}
                </Pressable>
                <Button
                    onPress={onNext}
                    disabled={!canAdvance}
                    size="icon"
                    className="h-11 w-11 rounded-full"
                    accessibilityLabel="Show full query results"
                >
                    <Ionicons
                        name="arrow-forward"
                        size={21}
                        color={theme.primaryForeground}
                    />
                </Button>
            </View>

            {!isLibraryConnected ? (
                <Text className="mt-2 text-sm text-muted-foreground">
                    Connect Apple Music to match songs from your library.
                </Text>
            ) : error ? (
                <Text className="mt-2 text-sm text-destructive">
                    Results could not be refreshed. Your query is still safe.
                </Text>
            ) : null}

            {expanded ? (
                <View
                    className="mt-2 overflow-hidden rounded-xl border border-border bg-card"
                    style={{ height: previewHeight }}
                >
                    {count === 0 && !loading && !libraryLoading ? (
                        <View className="flex-1 items-center justify-center px-6">
                            <Text className="text-center text-muted-foreground">
                                No songs match this query.
                            </Text>
                        </View>
                    ) : (
                        <MusicList
                            tracks={songs}
                            isLoading={loading || libraryLoading}
                            anticipatedTrackCount={count}
                            pagination={null}
                            sorting={null}
                            embedded
                            showTags
                            fullBleedRows
                            fullBleedRowHorizontalPadding={12}
                            rowSurfaceColor="card"
                        />
                    )}
                </View>
            ) : null}
        </View>
    );
}
