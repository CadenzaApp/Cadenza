import {useEffect, useState} from "react";
import {Image, Modal, Pressable, ScrollView, View} from "react-native";
import {MusicItem as AppleMusicItem} from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";

import {Button} from "@/components/ui/button";
import {Text} from "@/components/ui/text";
import {TagPill} from "@/components/custom/tag-pill";
import {Tag} from "@/types/tag-types";

type SongDetailModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    song: AppleMusicItem | null;
    tags: Tag[];
    onTogglePlayback: (trackId: string) => void;
    isThisTrackPlaying: boolean;
};

type MusicItemWithOptionalMetadata = AppleMusicItem & {
    albumName?: string;
    albumTitle?: string;
    collectionName?: string;
};

function toDisplayString(value: unknown, fallback = "Unavailable") {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return fallback;
}

export function SongDetailModal({
                                    open,
                                    onOpenChange,
                                    song,
                                    tags,
                                    onTogglePlayback,
                                    isThisTrackPlaying,
                                }: SongDetailModalProps) {
    const [artworkFailed, setArtworkFailed] = useState(false);

    useEffect(() => {
        setArtworkFailed(false);
    }, [song?.id, song?.artworkUrl]);

    const songWithMetadata = song as MusicItemWithOptionalMetadata | null;
    const artworkUrl = song?.artworkUrl?.trim();
    const canRenderArtwork =
        !artworkFailed &&
        typeof artworkUrl === "string" &&
        /^https?:\/\//i.test(artworkUrl);

    const albumName = toDisplayString(
        songWithMetadata?.albumName ||
        songWithMetadata?.albumTitle ||
        songWithMetadata?.collectionName,
        "Unknown Album",
    );

    function handleAddTagPress() {
        // TODO: Hook this up when song-to-tag assignment is implemented.
    }

    function handleAskAiForTagsPress() {
        // TODO: Hook this up when AI tag suggestions are wired into the app.
    }

    function handlePlayPress() {
        if (!song?.id) return;
        onTogglePlayback(song.id);
    }

    return (
        <Modal
            visible={open}
            transparent
            animationType="fade"
            onRequestClose={() => onOpenChange(false)}
        >
            <Pressable
                className="flex-1 bg-black/70 items-center justify-center px-4 py-8"
                onPress={() => onOpenChange(false)}
            >
                <Pressable
                    onPress={(event) => event.stopPropagation()}
                    className="w-full max-w-[560px] bg-popover border border-border rounded-xl overflow-hidden"
                    style={{height: "82%"}}
                >
                    <View className="px-5 py-4 border-b border-border">
                        <View className="flex-row items-start justify-between gap-3">
                            <View className="flex-1">
                                <Text
                                    className="text-lg font-semibold text-foreground"
                                    numberOfLines={2}
                                >
                                    {toDisplayString(song?.title, "Unknown Title")}
                                </Text>
                                <Text
                                    className="text-sm text-muted-foreground mt-1"
                                    numberOfLines={1}
                                >
                                    {toDisplayString(song?.artistName, "Unknown Artist")}
                                </Text>
                            </View>

                            <View className="flex-row gap-2">
                                <Button
                                    size="icon"
                                    className="h-11 w-11 rounded-full shrink-0"
                                    onPress={handlePlayPress}
                                    disabled={!song?.id}
                                    variant={isThisTrackPlaying ? "secondary" : "default"}
                                >
                                    <Text>
                                        <Ionicons
                                            name={isThisTrackPlaying ? "pause" : "play"}
                                            size={22}
                                            style={{marginLeft: isThisTrackPlaying ? 0 : 3}}
                                        />
                                    </Text>
                                </Button>

                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-10 w-10 rounded-full"
                                    onPress={() => onOpenChange(false)}
                                >
                                    <Text>
                                        <Ionicons name="close" size={20}/>
                                    </Text>
                                </Button>
                            </View>
                        </View>
                    </View>

                    {!song ? (
                        <View className="px-5 py-6">
                            <Text className="text-muted-foreground">
                                No song selected.
                            </Text>
                        </View>
                    ) : (
                        <ScrollView
                            className="flex-1"
                            showsVerticalScrollIndicator={false}
                            contentContainerClassName="px-5 py-5 gap-5"
                        >
                            <View className="flex-row items-center gap-4">
                                {canRenderArtwork ? (
                                    <Image
                                        source={{uri: artworkUrl}}
                                        className="w-24 h-24 rounded-md bg-muted"
                                        onError={() => setArtworkFailed(true)}
                                    />
                                ) : (
                                    <View className="w-24 h-24 rounded-md bg-muted items-center justify-center">
                                        <Text className="text-xs text-muted-foreground">
                                            No Art
                                        </Text>
                                    </View>
                                )}

                                <View className="flex-1 gap-1">
                                    <Text className="text-base font-semibold text-foreground">
                                        Album
                                    </Text>
                                    <Text className="text-sm text-muted-foreground">
                                        {albumName}
                                    </Text>
                                </View>
                            </View>

                            <View className="border border-border rounded-md p-3 gap-2">
                                <View className="flex-row items-start justify-between gap-3">
                                    <Text className="text-sm text-muted-foreground">
                                        Track ID
                                    </Text>
                                    <Text
                                        className="text-sm text-foreground flex-1 text-right"
                                        numberOfLines={2}
                                    >
                                        {toDisplayString(song.id)}
                                    </Text>
                                </View>

                                <View className="flex-row items-start justify-between gap-3">
                                    <Text className="text-sm text-muted-foreground">
                                        Playback Type
                                    </Text>
                                    <Text
                                        className="text-sm text-foreground flex-1 text-right"
                                        numberOfLines={1}
                                    >
                                        {toDisplayString(song.playbackType)}
                                    </Text>
                                </View>
                            </View>

                            <View className="gap-2">
                                <Text className="text-sm font-medium text-foreground">
                                    Tags
                                </Text>

                                {tags.length > 0 ? (
                                    <View className="flex-row flex-wrap gap-2">
                                        {tags.map((tag) => (
                                            <TagPill key={tag.id} tag={tag} height={12}/>
                                        ))}
                                    </View>
                                ) : (
                                    <Text className="text-sm text-muted-foreground">
                                        No tags applied.
                                    </Text>
                                )}
                            </View>

                            <View className="flex-row gap-2 pb-1">
                                <Button
                                    variant="secondary"
                                    className="flex-1 h-11"
                                    onPress={handleAddTagPress}
                                >
                                    <Text>Add Tag</Text>
                                </Button>
                                <Button
                                    className="flex-1 h-11"
                                    onPress={handleAskAiForTagsPress}
                                >
                                    <Text>Ask AI for Tags</Text>
                                </Button>
                            </View>
                        </ScrollView>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
}