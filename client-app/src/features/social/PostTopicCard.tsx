import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo } from "react";
import { Image, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useOpenScreen } from "@/lib/open-screen";
import { useSongInfo } from "@/lib/musickit-hooks";
import { toggleTopicPreview, useTopicPreview } from "@/lib/topic-preview";
import type { PostTopic } from "@/lib/types";
import { isUsableArtworkUrl } from "@/lib/utils";

import { topicFromSong, topicSubtitle, topicTitle } from "./topic";

const ARTWORK_SIZE = 64;
const ICON_SIZE = 28;

type Props = {
    topic: PostTopic;
    /** Distinguishes this card from others with the same song. */
    cardId?: string;
    /** Shows a clear control, used by the compose dialog. */
    onRemove?: () => void;
};

/**
 * The song or artist attached to a post: artwork, title, and a play overlay
 * for songs. Songs play Apple's preview clip and pause the shared player
 * until the clip ends.
 */
export function PostTopicCard({ topic, cardId, onRemove }: Props) {
    const openScreen = useOpenScreen();
    const songId =
        topic.kind === "song" ? (topic.catalogId ?? topic.id) : undefined;
    const previewCardId = cardId ?? songId;
    const needsSongInfo =
        topic.kind === "song" &&
        (!topic.title || !topic.artworkUrl || !topic.previewUrl);
    const { songInfo } = useSongInfo(needsSongInfo && songId ? [songId] : null);
    const resolved = useMemo(() => {
        if (topic.kind !== "song") return topic;
        const info = songInfo.find(
            (song) =>
                song.id === topic.id ||
                song.catalogId === topic.id ||
                song.id === topic.catalogId,
        );
        return info ? { ...topicFromSong(info), id: topic.id } : topic;
    }, [songInfo, topic]);
    const isSong = resolved.kind === "song";
    const preview = useTopicPreview();
    const isThisPreview =
        isSong &&
        previewCardId != null &&
        preview.cardId === previewCardId &&
        (preview.playing || preview.loading);
    const playing = isThisPreview && preview.playing;
    const loading = isThisPreview && preview.loading;
    const title = topicTitle(resolved);
    const subtitle = topicSubtitle(resolved);
    const artistCatalogId =
        resolved.kind === "artist" ? resolved.catalogId : undefined;

    function onPlayPress() {
        if (resolved.kind !== "song" || previewCardId == null) return;
        void toggleTopicPreview(
            previewCardId,
            resolved.catalogId ?? resolved.id,
            resolved.previewUrl,
        );
    }

    function onCardPress() {
        if (isSong) {
            onPlayPress();
            return;
        }
        // Compose keeps the picker open; don't navigate away from it.
        if (onRemove || !artistCatalogId) return;
        openScreen({
            pathname: "/artist/[id]",
            params: { id: artistCatalogId, name: resolved.name },
        });
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={
                isSong
                    ? playing
                        ? `Pause ${title || "song"}`
                        : `Play ${title || "song"}`
                    : artistCatalogId
                      ? `View ${title}`
                      : title
            }
            onPress={onCardPress}
            className="relative flex-none flex-row overflow-hidden rounded-lg bg-muted active:opacity-80"
        >
            <View
                className="shrink-0 overflow-hidden bg-secondary"
                style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }}
            >
                <TopicArtwork topic={resolved} />
                {isSong ? (
                    <View
                        pointerEvents="none"
                        className="absolute inset-0 items-center justify-center bg-black/40"
                    >
                        {loading ? (
                            <Ionicons
                                name="ellipsis-horizontal"
                                size={ICON_SIZE}
                                color="#ffffff"
                            />
                        ) : (
                            <Ionicons
                                name={playing ? "pause" : "play"}
                                size={ICON_SIZE}
                                color="#ffffff"
                                style={{ marginLeft: playing ? 0 : 2 }}
                            />
                        )}
                    </View>
                ) : null}
            </View>

            <View className="min-w-0 flex-1 justify-center px-3">
                <Text
                    className="text-base font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {title}
                </Text>
                {subtitle ? (
                    <Text
                        className="text-xs text-muted-foreground"
                        numberOfLines={1}
                    >
                        {subtitle}
                    </Text>
                ) : null}
            </View>

            {onRemove ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove attached topic"
                    onPress={(event) => {
                        event.stopPropagation();
                        onRemove();
                    }}
                    hitSlop={10}
                    className="mr-2 h-8 w-8 items-center justify-center rounded-full active:opacity-60"
                >
                    <Ionicons name="close" size={16} color="#a1a1a1" />
                </Pressable>
            ) : null}

            {playing || (isThisPreview && preview.progress > 0) ? (
                <ProgressBar ratio={preview.progress} />
            ) : null}
        </Pressable>
    );
}

function TopicArtwork({ topic }: { topic: PostTopic }) {
    if (isUsableArtworkUrl(topic.artworkUrl)) {
        return (
            <Image
                source={{ uri: topic.artworkUrl }}
                className="h-full w-full"
                resizeMode="cover"
            />
        );
    }
    if (topic.kind === "artist") {
        return (
            <View className="h-full w-full items-center justify-center bg-secondary">
                <Ionicons name="person" size={22} color="#a1a1a1" />
            </View>
        );
    }
    return (
        <View className="h-full w-full items-center justify-center bg-secondary">
            <Ionicons name="musical-notes" size={22} color="#a1a1a1" />
        </View>
    );
}

function ProgressBar({ ratio }: { ratio: number }) {
    return (
        <View
            pointerEvents="none"
            className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/20"
        >
            <View
                className="h-full bg-white"
                style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
            />
        </View>
    );
}
