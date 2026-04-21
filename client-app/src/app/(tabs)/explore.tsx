import { useState } from "react";
import {
    View,
    FlatList,
    ActivityIndicator,
    Alert,
    Image,
} from "react-native";
import {
    MusicKit,
    Player,
    useIsPlaying,
    type MusicItem,
    PlaybackQueueType,
} from "@apple-musickit";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Card, CardContent } from "@/components/ui/card";
import { useAppleMusic } from "@/lib/apple-music";

function getErrorDetails(error: unknown) {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            code: (error as any).code,
            nativeStackIOS: (error as any).nativeStackIOS,
            cause: (error as any).cause,
        };
    }

    if (typeof error === "object" && error !== null) {
        return error;
    }

    return { message: String(error) };
}

function getErrorMessage(error: unknown) {
    const details = getErrorDetails(error);
    if (
        typeof details === "object" &&
        details !== null &&
        "message" in details
    ) {
        return String(details.message);
    }

    return "Unknown error";
}

export default function ExploreScreen() {
    const [tracks, setTracks] = useState<MusicItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
    const [failedArtworkIds, setFailedArtworkIds] = useState<Set<string>>(
        () => new Set(),
    );

    const { isInitializing, isConnected, ensureConnected } = useAppleMusic();
    const isPlaying = useIsPlaying();

    async function handleFetchLibrary() {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before loading your library.",
            );
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            await ensureConnected();
            const result = await MusicKit.getTracksFromLibrary();
            setTracks(result.items || []);
            setFailedArtworkIds(new Set());
        } catch (e) {
            console.error(
                "Failed to fetch library tracks:",
                getErrorDetails(e),
            );
            setError(`Failed to load library tracks. ${getErrorMessage(e)}`);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleTogglePlayback(trackId: string) {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before playing songs.",
            );
            return;
        }

        try {
            await ensureConnected();

            if (activeTrackId === trackId) {
                await Player.togglePlayerState();
            } else {
                await MusicKit.setPlaybackQueue(trackId, PlaybackQueueType.LibrarySong);
                await Player.play();
                setActiveTrackId(trackId);
            }
        } catch (e) {
            console.error("Failed to toggle playback:", getErrorDetails(e));
            Alert.alert(
                "Playback Error",
                `Failed to update playback state. ${getErrorMessage(e)}`,
            );
        }
    }

    function getArtworkUrl(item: MusicItem) {
        const artworkUrl = item.artworkUrl?.trim();

        if (
            !artworkUrl ||
            failedArtworkIds.has(item.id) ||
            !/^https?:\/\//i.test(artworkUrl)
        ) {
            return null;
        }

        return artworkUrl;
    }

    const renderTrackItem = ({ item }: { item: MusicItem }) => {
        const isThisTrackPlaying = activeTrackId === item.id && isPlaying;
        const artworkUrl = getArtworkUrl(item);

        return (
            <Card className="mb-3 py-2">
                <CardContent className="flex-row justify-between items-center py-0">
                    <View className="flex-1 mr-4 flex-row items-center">
                        {artworkUrl ? (
                            <Image
                                source={{ uri: artworkUrl }}
                                className="w-12 h-12 rounded bg-muted mr-3"
                                onError={() => {
                                    setFailedArtworkIds((current) => {
                                        const next = new Set(current);
                                        next.add(item.id);
                                        return next;
                                    });
                                }}
                            />
                        ) : (
                            <View className="w-12 h-12 rounded bg-muted mr-3 items-center justify-center">
                                <Text className="text-xs text-muted-foreground">
                                    No Art
                                </Text>
                            </View>
                        )}

                        <View className="flex-1">
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
                    </View>

                    <Button
                        size="sm"
                        onPress={() => handleTogglePlayback(item.id)}
                        disabled={isInitializing || !isConnected}
                        variant={isThisTrackPlaying ? "secondary" : "default"}
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

                <Button
                    onPress={handleFetchLibrary}
                    disabled={isInitializing || isLoading || !isConnected}
                >
                    <Text>{isLoading ? "Loading..." : "Load Library Songs"}</Text>
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
