import type { MusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { Image, Pressable, View } from "react-native";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { usePlaybackCommands } from "@/lib/playback";

const PLACEHOLDER_COUNT = 4;

/**
 * The most recently added songs, as a two column artwork grid. Apple shows
 * albums here, but `dateAdded` ordering is only available on library songs, so
 * these are songs and tapping one plays it.
 */
export function RecentlyAdded({
    tracks,
    isLoading,
}: {
    tracks: MusicItem[];
    isLoading: boolean;
}) {
    const { togglePlayback } = usePlaybackCommands();

    if (!isLoading && tracks.length === 0) return null;

    return (
        <View className="px-6 pt-6">
            <Text className="mb-4 text-2xl font-bold tracking-tight">
                Recently Added
            </Text>

            <View className="flex-row flex-wrap justify-between gap-y-5">
                {isLoading && tracks.length === 0
                    ? Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
                          <View key={index} className="w-[48%]">
                              <Skeleton className="aspect-square w-full rounded-lg" />
                              <Skeleton className="mt-2 h-4 w-3/4 rounded" />
                              <Skeleton className="mt-1 h-3 w-1/2 rounded" />
                          </View>
                      ))
                    : tracks.map((track) => (
                          <RecentlyAddedTile
                              key={track.id}
                              track={track}
                              onPress={() => void togglePlayback(track)}
                          />
                      ))}
            </View>
        </View>
    );
}

function RecentlyAddedTile({
    track,
    onPress,
}: {
    track: MusicItem;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    const artworkUrl =
        track.artworkUrlLarge?.trim() ?? track.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" && /^https?:\/\//i.test(artworkUrl);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Play ${track.title}`}
            onPress={onPress}
            className="w-[48%] active:opacity-80"
        >
            {canRenderArtwork ? (
                <Image
                    source={{ uri: artworkUrl }}
                    className="aspect-square w-full rounded-lg bg-muted"
                />
            ) : (
                <View className="aspect-square w-full items-center justify-center rounded-lg bg-muted">
                    <Ionicons
                        name="musical-notes"
                        size={28}
                        color={colors.text}
                    />
                </View>
            )}
            <Text
                className="mt-2 font-semibold leading-tight"
                numberOfLines={1}
            >
                {track.title}
            </Text>
            <Text
                className="mt-0.5 text-sm leading-tight text-muted-foreground"
                numberOfLines={1}
            >
                {track.artistName}
            </Text>
        </Pressable>
    );
}
