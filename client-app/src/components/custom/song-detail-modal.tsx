import {useEffect, useState} from "react";
import {Image, ScrollView, View} from "react-native";
import {MusicItem as AppleMusicItem} from "@apple-musickit";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Text} from "@/components/ui/text";
import {TagPill} from "@/components/custom/tag-pill";
import {Tag} from "@/types/tag-types";

type SongDetailModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    song: AppleMusicItem | null;
    tags: Tag[];
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="p-0 gap-0 max-h-[85%]">
                {!song ? (
                    <View className="px-6 py-8">
                        <Text className="text-muted-foreground">
                            No song selected.
                        </Text>
                    </View>
                ) : (
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerClassName="px-6 py-5 gap-5"
                    >
                        <DialogHeader className="pr-8">
                            <DialogTitle>{toDisplayString(song.title, "Unknown Title")}</DialogTitle>
                            <DialogDescription>
                                {toDisplayString(song.artistName, "Unknown Artist")}
                            </DialogDescription>
                        </DialogHeader>

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

                        <View className="flex-row gap-2">
                            <Button
                                variant="secondary"
                                className="flex-1"
                                onPress={handleAddTagPress}
                            >
                                <Text>Add Tag</Text>
                            </Button>
                            <Button
                                className="flex-1"
                                onPress={handleAskAiForTagsPress}
                            >
                                <Text>Ask AI for Tags</Text>
                            </Button>
                        </View>
                    </ScrollView>
                )}
            </DialogContent>
        </Dialog>
    );
}
