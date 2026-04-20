import { useState } from "react";
import { View, ActivityIndicator } from "react-native";
import {
    MusicKit,
    MusicItem as AppleMusicItem,
} from "@apple-musickit";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { MusicList } from "@/components/custom/music-list";
import { usePlayback } from "@/lib/playback";

export default function ExploreScreen() {
    const [tracks, setTracks] = useState<AppleMusicItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();

    async function handleFetchLibrary() {
        setIsLoading(true);
        setError(null);

        try {
            const result = await MusicKit.getTracksFromLibrary();
            setTracks(result.items || []);
        } catch (e) {
            console.error("Failed to fetch library tracks:", e);
            setError(
                "Failed to load library tracks. Ensure you are authorized.",
            );
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <View className="flex-1 bg-background pt-16">
            <View className="px-6 mb-4">
                <Button onPress={handleFetchLibrary} disabled={isLoading}>
                    <Text>
                        {isLoading ? "Loading..." : "Load Library Songs"}
                    </Text>
                </Button>
            </View>

            {isLoading && (
                <View className="my-6 items-center">
                    <ActivityIndicator size="large" color="#888" />
                </View>
            )}

            {error && (
                <Text className="text-destructive text-center my-2 px-6">
                    {error}
                </Text>
            )}

            <MusicList
                tracks={tracks}
                isLoading={isLoading}
                activeTrackId={activeTrackId}
                isPlaying={isPlaying}
                onTogglePlayback={togglePlayback}
            />
        </View>
    );
}
