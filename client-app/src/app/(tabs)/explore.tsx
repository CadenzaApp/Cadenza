import { useState } from "react";
import { View, FlatList, ActivityIndicator, Alert } from "react-native";
import { MusicKit, Player } from "@apple-musickit";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Card, CardContent } from "@/components/ui/card";

export default function ExploreScreen() {
    // Data states
    const [tracks, setTracks] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Playback UI states
    const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

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

    async function handleTogglePlayback(trackId: string) {
        try {
            if (activeTrackId === trackId) {
                // If clicking the track that is already active, just toggle pause/play
                if (isPlaying) {
                    await Player.pause();
                    setIsPlaying(false);
                } else {
                    await Player.play();
                    setIsPlaying(true);
                }
            } else {
                // If clicking a new track, load it into the queue.
                // Because native prepare() uses playWhenReady = true, we DO NOT call Player.play() here.
                // It will automatically begin playing once the native stream buffers!
                await MusicKit.setPlaybackQueue(trackId, "song");

                setActiveTrackId(trackId);
                setIsPlaying(true);
            }
        } catch (e) {
            console.error("Failed to toggle playback:", e);
            Alert.alert("Playback Error", "Failed to update playback state.");
        }
    }

    const renderTrackItem = ({ item }: { item: any }) => {
        // Determine if THIS specific row is the one currently playing
        const isThisTrackPlaying = activeTrackId === item.id && isPlaying;

        return (
            <Card className="mb-3">
                <CardContent className="p-4 flex-row justify-between items-center">
                    <View className="flex-1 mr-4">
                        <Text
                            className="text-base font-bold text-foreground"
                            numberOfLines={1}
                        >
                            {item.title}
                        </Text>
                        <Text
                            className="text-sm text-muted-foreground mt-1"
                            numberOfLines={1}
                        >
                            {item.artistName}
                        </Text>
                    </View>
                    <Button
                        size="sm"
                        onPress={() => handleTogglePlayback(item.id)}
                        variant={isThisTrackPlaying ? "secondary" : "default"} // Optional: change visual style if playing
                    >
                        <Text>{isThisTrackPlaying ? "Pause" : "Play"}</Text>
                    </Button>
                </CardContent>
            </Card>
        );
    };

    return (
        <View className="flex-1 bg-background pt-16">
            <View className="px-6 mb-4">
                <Text className="text-3xl font-bold text-foreground mb-6">
                    Explore
                </Text>
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

            <FlatList
                data={tracks}
                keyExtractor={(item, index) => item.id || index.toString()}
                renderItem={renderTrackItem}
                contentContainerClassName="px-6 pb-10"
                ListEmptyComponent={
                    !isLoading && tracks.length === 0 ? (
                        <Text className="text-muted-foreground text-center mt-10">
                            No tracks loaded yet.
                        </Text>
                    ) : null
                }
            />
        </View>
    );
}
