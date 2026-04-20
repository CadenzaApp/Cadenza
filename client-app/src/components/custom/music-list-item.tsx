import { View, Image } from "react-native";
import { MusicItem as AppleMusicItem } from "@apple-musickit";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Card, CardContent } from "@/components/ui/card";

type MusicItemProps = {
    item: AppleMusicItem;
    isThisTrackPlaying: boolean;
    onTogglePlayback: (trackId: string) => void;
};

export function MusicListItem({ item, isThisTrackPlaying, onTogglePlayback }: MusicItemProps) {
    return (
        <Card className="mb-3 py-2">
            <CardContent className="flex-row justify-between items-center py-0">
                <View className="flex-1 mr-4 flex-row items-center">
                    {item.artworkUrl ? (
                        <Image
                            source={{ uri: item.artworkUrl }}
                            className="w-12 h-12 rounded bg-muted mr-3"
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
                    onPress={() => item.id && onTogglePlayback(item.id)}
                    variant={isThisTrackPlaying ? "secondary" : "default"}
                >
                    <Text>{isThisTrackPlaying ? "Pause" : "Play"}</Text>
                </Button>
            </CardContent>
        </Card>
    );
}
