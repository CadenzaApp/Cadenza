import { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View } from "react-native";
import { MusicItem as AppleMusicItem, MusicKit } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { Tag } from "@/types/tag-types";
import { useTags } from "@/lib/tags";
import { useAccount } from "@/lib/account";
import { requestSongTagSuggestions } from "@/lib/tag-generation";

type SongDetailModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    song: AppleMusicItem | null;
    tags: Tag[];
    onTogglePlayback: (trackId: string) => void;
    isThisTrackPlaying: boolean;
    onApplyTag?: (tag: Tag) => void;
    onRemoveTag?: (tag: Tag) => void;
};

function toDisplayString(value: unknown, fallback = "Unavailable") {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return fallback;
}

const releaseDateOptions: Intl.DateTimeFormatOptions = {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
};
const dateFormatter = new Intl.DateTimeFormat("en-US", releaseDateOptions);

function formatSeconds(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const parts: string[] = [];

    if (hours > 0) {
        parts.push(`${hours}h`);
    }

    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }

    parts.push(`${seconds}s`);

    return parts.join(" ");
}

export function SongDetailModal({
    open,
    onOpenChange,
    song,
    tags,
    onTogglePlayback,
    isThisTrackPlaying,
    onApplyTag,
    onRemoveTag,
}: SongDetailModalProps) {
    const [artworkFailed, setArtworkFailed] = useState(false);
    const [activePanel, setActivePanel] = useState<"addTag" | "aiTags" | null>(
        null,
    );
    const [aiSuggestedTagNames, setAiSuggestedTagNames] = useState<string[]>(
        [],
    );
    const [isAiSuggestionsLoading, setIsAiSuggestionsLoading] = useState(false);
    const [aiSuggestionsError, setAiSuggestionsError] = useState<string | null>(
        null,
    );
    const { account } = useAccount();
    const { tags: allUserTags, loading: tagsLoading } = useTags();

    useEffect(() => {
        setArtworkFailed(false);
        setActivePanel(null);
        setAiSuggestedTagNames([]);
        setAiSuggestionsError(null);
        setIsAiSuggestionsLoading(false);
    }, [song?.id, song?.artworkUrl]);

    const artworkUrl = song?.artworkUrl?.trim();
    const canRenderArtwork =
        !artworkFailed &&
        typeof artworkUrl === "string" &&
        /^https?:\/\//i.test(artworkUrl);

    const albumName = toDisplayString(song?.albumName, "Unknown Album");

    const releaseDate = toDisplayString(
        dateFormatter.format(new Date(song?.releaseDate ?? 0)),
        "Unknown Release Date",
    );

    const songDuration = formatSeconds(song?.songDuration ?? 0);

    function handleAddTagPress() {
        setActivePanel((prev) => (prev === "addTag" ? null : "addTag"));
    }

    async function handleAskAiForTagsPress() {
        const shouldOpenPanel = activePanel !== "aiTags";
        setActivePanel((prev) => (prev === "aiTags" ? null : "aiTags"));

        if (!shouldOpenPanel) {
            return;
        }

        if (!song?.id) {
            setAiSuggestedTagNames([]);
            setAiSuggestionsError("Unable to find this song ID.");
            return;
        }

        if (!account?.jwt) {
            setAiSuggestedTagNames([]);
            setAiSuggestionsError(
                "You need to sign in to request AI suggestions.",
            );
            return;
        }

        setIsAiSuggestionsLoading(true);
        setAiSuggestionsError(null);

        try {
            let metadataSong = song;
            if (!hasRequiredMetadata(song)) {
                metadataSong = (await MusicKit.getSongInfo([song.id]))[0];
            }

            const title = normalizeRequiredString(
                metadataSong.title,
                "Song title is unavailable.",
            );
            const artist = normalizeRequiredString(
                metadataSong.artistName,
                "Song artist is unavailable.",
            );
            const album = normalizeOptionalString(metadataSong.albumName);

            const suggestedTags = await requestSongTagSuggestions({
                jwt: account.jwt,
                songId: song.id,
                title,
                artist,
                album,
                sourceProvider: "apple_music",
            });

            setAiSuggestedTagNames(suggestedTags);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to generate AI tag suggestions.";
            setAiSuggestedTagNames([]);
            setAiSuggestionsError(message);
        } finally {
            setIsAiSuggestionsLoading(false);
        }
    }

    function handlePlayPress() {
        if (!song?.id) return;
        onTogglePlayback(song.id);
    }

    const aiSuggestedTags: Tag[] = aiSuggestedTagNames.map((name, index) => ({
        id: `ai-${index}-${name}`,
        name,
        color: "#7c3aed",
    }));

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
                    style={{ height: "82%" }}
                >
                    <View className="px-5 py-4 border-b border-border">
                        <View className="flex-row items-start justify-between gap-3">
                            <View className="flex-1">
                                <Text
                                    className="text-lg font-semibold text-foreground"
                                    numberOfLines={2}
                                >
                                    {toDisplayString(
                                        song?.title,
                                        "Unknown Title",
                                    )}
                                </Text>
                                <Text
                                    className="text-sm text-muted-foreground mt-1"
                                    numberOfLines={1}
                                >
                                    {toDisplayString(
                                        song?.artistName,
                                        "Unknown Artist",
                                    )}
                                </Text>
                            </View>

                            <View className="flex-row gap-2">
                                <Button
                                    size="icon"
                                    className="h-11 w-11 rounded-full shrink-0"
                                    onPress={handlePlayPress}
                                    disabled={!song?.id}
                                    variant={
                                        isThisTrackPlaying
                                            ? "secondary"
                                            : "default"
                                    }
                                >
                                    <Text>
                                        <Ionicons
                                            name={
                                                isThisTrackPlaying
                                                    ? "pause"
                                                    : "play"
                                            }
                                            size={22}
                                            style={{
                                                marginLeft: isThisTrackPlaying
                                                    ? 0
                                                    : 3,
                                            }}
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
                                        <Ionicons name="close" size={20} />
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
                                        source={{ uri: artworkUrl }}
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
                                        {albumName}
                                    </Text>
                                    <Text className="text-sm text-muted-foreground">
                                        {releaseDate}
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

                                <View className="flex-row items-start justify-between gap-3">
                                    <Text className="text-sm text-muted-foreground">
                                        Duration
                                    </Text>
                                    <Text
                                        className="text-sm text-foreground flex-1 text-right"
                                        numberOfLines={2}
                                    >
                                        {songDuration}
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
                                            <TagPill
                                                key={tag.id}
                                                tag={tag}
                                                height={12}
                                                onRemove={() =>
                                                    onRemoveTag?.(tag)
                                                }
                                            />
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
                                    variant={
                                        activePanel === "addTag"
                                            ? "default"
                                            : "secondary"
                                    }
                                    className="flex-1 h-11"
                                    onPress={handleAddTagPress}
                                >
                                    <Text>Add Tags</Text>
                                </Button>
                                <Button
                                    variant={
                                        activePanel === "aiTags"
                                            ? "default"
                                            : "secondary"
                                    }
                                    className="flex-1 h-11"
                                    onPress={handleAskAiForTagsPress}
                                >
                                    <Text>Ask AI for Tags</Text>
                                </Button>
                            </View>

                            {activePanel === "aiTags" && (
                                <View className="border border-border rounded-md p-3 gap-3 pb-4">
                                    <Text className="text-sm font-medium text-foreground">
                                        AI suggested tags
                                    </Text>
                                    {isAiSuggestionsLoading ? (
                                        <Text className="text-sm text-muted-foreground">
                                            Generating suggestions...
                                        </Text>
                                    ) : aiSuggestionsError ? (
                                        <Text className="text-sm text-destructive">
                                            {aiSuggestionsError}
                                        </Text>
                                    ) : aiSuggestedTags.length === 0 ? (
                                        <Text className="text-sm text-muted-foreground">
                                            No suggestions returned.
                                        </Text>
                                    ) : (
                                        <View className="flex-row flex-wrap gap-2">
                                            {aiSuggestedTags.map((tag) => (
                                                <TagPill
                                                    key={tag.id}
                                                    tag={tag}
                                                    height={12}
                                                />
                                            ))}
                                        </View>
                                    )}
                                </View>
                            )}

                            {activePanel === "addTag" && (
                                <View className="border border-border rounded-md p-3 gap-3 pb-4">
                                    <Text className="text-sm font-medium text-foreground">
                                        Your tags
                                    </Text>
                                    {tagsLoading ? (
                                        <Text className="text-sm text-muted-foreground">
                                            Loading...
                                        </Text>
                                    ) : allUserTags.length === 0 ? (
                                        <Text className="text-sm text-muted-foreground">
                                            No tags created yet.
                                        </Text>
                                    ) : (
                                        <View className="flex-row flex-wrap gap-2">
                                            {allUserTags
                                                .filter(
                                                    (tag) =>
                                                        !tags.some(
                                                            (t) =>
                                                                t.id === tag.id,
                                                        ),
                                                )
                                                .map((tag) => (
                                                    <Pressable
                                                        key={tag.id}
                                                        onPress={() =>
                                                            onApplyTag?.(tag)
                                                        }
                                                    >
                                                        <TagPill
                                                            tag={tag}
                                                            height={12}
                                                        />
                                                    </Pressable>
                                                ))}
                                        </View>
                                    )}
                                </View>
                            )}
                        </ScrollView>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredString(value: unknown, message: string): string {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        throw new Error(message);
    }
    return normalized;
}

function hasRequiredMetadata(song: AppleMusicItem): boolean {
    const title = normalizeOptionalString(song.title);
    const artist = normalizeOptionalString(song.artistName);
    return Boolean(title && artist);
}
