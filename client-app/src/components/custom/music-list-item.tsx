import { View, Image, ScrollView } from "react-native";
import { MusicItem as AppleMusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@react-navigation/native";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { Tag } from "@/types/tag-types";

// Dummy data for testing the UI before the database is hooked up
const DUMMY_TAGS: Tag[] = [
    { id: "1", name: "chill", color: "#1f93d6" },
    { id: "2", name: "hiphop", color: "#ce7129" },
    { id: "3", name: "lofi", color: "#5644ce" },
    { id: "4", name: "focus", color: "#25924f" },
];

// Helper to calculate rgba for the gradient fade
function hexToRgba(hex: string, alpha: number) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

type MusicItemProps = {
    item: AppleMusicItem;
    isThisTrackPlaying: boolean;
    onTogglePlayback: (trackId: string) => void;
    tags?: Tag[];
};

export function MusicListItem({
    item,
    isThisTrackPlaying,
    onTogglePlayback,
    tags = DUMMY_TAGS
}: MusicItemProps) {
    const { colors } = useTheme();

    return (
        <View className="flex-row items-center justify-between py-3 border-b border-border">

            {/* Left Column: Artwork + (Info & Tags) */}
            <View className="flex-1 flex-row items-center mr-3 overflow-hidden">
                {item.artworkUrl ? (
                    <Image
                        source={{ uri: item.artworkUrl }}
                        className="w-14 h-14 shrink-0 aspect-square rounded bg-muted mr-3"
                    />
                ) : (
                    <View className="w-12 h-12 shrink-0 aspect-square rounded bg-muted mr-3 items-center justify-center">
                        <Text className="text-xs text-muted-foreground text-center">
                            No Art
                        </Text>
                    </View>
                )}

                {/* Middle Column: Info & Tags */}
                <View className="flex-1 flex-col justify-center gap-1.5 overflow-hidden">

                    {/* Song Info */}
                    <View>
                        <Text
                            className="text-base font-bold text-foreground leading-tight"
                            numberOfLines={1}
                        >
                            {item.title}
                        </Text>
                        <Text
                            className="text-sm text-muted-foreground mt-0.5 leading-tight"
                            numberOfLines={1}
                        >
                            {item.artistName}
                        </Text>
                    </View>

                    {/* Tags Scrollable */}
                    {tags.length > 0 && (
                        <View className="relative">
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={{ gap: 6, paddingRight: 24 }}
                            // fadingEdgeLength={24} <-- You can also optionally add this, which activates a native fade on Android!
                            >
                                {tags.map((tag) => (
                                    <TagPill key={tag.id} tag={tag} height={10} />
                                ))}
                            </ScrollView>

                            {/* Right edge fade overlay */}
                            <LinearGradient
                                colors={[hexToRgba(colors.background, 0), colors.background]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={{
                                    position: "absolute",
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 24,
                                }}
                                pointerEvents="none"
                            />
                        </View>
                    )}
                </View>
            </View>

            {/* Right Column: Pause/Play Button */}
            <Button
                size="icon"
                className="h-11 w-11 rounded-full shrink-0"
                onPress={() => item.id && onTogglePlayback(item.id)}
                variant={isThisTrackPlaying ? "secondary" : "default"}
            >
                <Text>
                    <Ionicons
                        name={isThisTrackPlaying ? "pause" : "play"}
                        size={22}
                        style={{ marginLeft: isThisTrackPlaying ? 0 : 3 }}
                    />
                </Text>
            </Button>
        </View>
    );
}
