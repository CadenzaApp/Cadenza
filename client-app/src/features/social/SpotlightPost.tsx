import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { Text } from "@/components/ui/text";
import { useOpenScreen } from "@/lib/open-screen";
import { toggleTopicPreview, useTopicPreview } from "@/lib/topic-preview";
import { useAppTheme } from "@/lib/theme";
import type { PostTopic } from "@/lib/types";
import { cn } from "@/lib/utils";

import { topicSubtitle, topicTitle } from "./topic";

/** Apple cover urls end in a size like `200x200bb`. The hero wants the large one. */
function heroArtworkUrl(topic: PostTopic | null): string | undefined {
    if (!topic) return undefined;
    const large = topic.kind === "song" ? topic.artworkUrlLarge : undefined;
    const url = large || topic.artworkUrl;
    if (!url) return undefined;
    return url.replace(/\/\d+x\d+bb(?=\.)/, "/1200x1200bb");
}

const ART_SONG = 220;
const ART_ARTIST = 260;
const VIZ_HEIGHT = 90;
const IDLE = "#a1a1a1";

/** Bar heights from the spotlight design, quiet on the left. */
const BARS = [
    { ratio: 0.12, opacity: 0, duration: 900, delay: 0 },
    { ratio: 0.14, opacity: 0.22, duration: 700, delay: 0 },
    { ratio: 0.2, opacity: 0.33, duration: 1150, delay: 350 },
    { ratio: 0.28, opacity: 0.44, duration: 700, delay: 550 },
    { ratio: 0.36, opacity: 0.56, duration: 620, delay: 0 },
    { ratio: 0.52, opacity: 0.67, duration: 1150, delay: 350 },
    { ratio: 0.7, opacity: 0.78, duration: 900, delay: 0 },
    { ratio: 0.84, opacity: 0.89, duration: 700, delay: 550 },
    { ratio: 1, opacity: 1, duration: 1150, delay: 350 },
] as const;

type Props = {
    topic: PostTopic | null;
    /** Distinguishes this card from others playing the same song. */
    cardId: string;
    liked: boolean;
    likes: number;
    commentCount: number;
    onToggleLike: () => void;
    /** Opens comments. Omitted when the comments are already open. */
    onOpenComments?: () => void;
};

/**
 * A spotlight post: no author, so the cover is the post. Tapping the cover
 * plays a song's preview, or opens an artist's page. Likes and comments stay
 * on the bar underneath. The cover keeps that height while its image loads.
 * While a preview plays, the cover shows pause, a
 * progress bar, and a visualizer. An artist has Apple's short note when the
 * catalog has one.
 */
export function SpotlightPost({
    topic,
    cardId,
    liked,
    likes,
    commentCount,
    onToggleLike,
    onOpenComments,
}: Props) {
    const { like } = useAppTheme().colors;
    const openScreen = useOpenScreen();
    const isSong = topic?.kind === "song";
    const isArtist = topic?.kind === "artist";
    const preview = useTopicPreview();
    const isThisPreview =
        isSong &&
        preview.cardId === cardId &&
        (preview.playing || preview.loading);
    const playing = isThisPreview && preview.playing;
    const loading = isThisPreview && preview.loading;
    const title = topic ? topicTitle(topic) : "";
    const subtitle = topic ? topicSubtitle(topic) : "";
    const bio =
        topic?.kind === "artist" ? topic.editorialNote?.trim() || "" : "";
    const artworkUrl = heroArtworkUrl(topic);
    const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const artworkReady = Boolean(artworkUrl) && loadedUrl === artworkUrl;
    const artworkFailed = Boolean(artworkUrl) && failedUrl === artworkUrl;
    // No url yet means the topic is still resolving. A url keeps the same
    // frame and only swaps the spinner for the bitmap.
    const artworkLoading = artworkUrl
        ? !artworkReady && !artworkFailed
        : !topic;

    function onPlay() {
        if (topic?.kind !== "song") return;
        void toggleTopicPreview(
            cardId,
            topic.catalogId ?? topic.id,
            topic.previewUrl,
        );
    }

    function onArtPress() {
        if (topic?.kind === "song") {
            onPlay();
            return;
        }
        if (topic?.kind !== "artist") return;
        const id = topic.catalogId ?? topic.id;
        if (!id) return;
        openScreen({
            pathname: "/artist/[id]",
            params: { id, name: topic.name },
        });
    }

    const label = isArtist
        ? "ARTIST SPOTLIGHT"
        : isSong
          ? "MUSIC SPOTLIGHT"
          : "SPOTLIGHT";

    return (
        <View className="overflow-hidden rounded-3xl bg-[#111111]">
            <View
                className="relative overflow-hidden"
                style={{ height: isArtist ? ART_ARTIST : ART_SONG }}
            >
                <RemoteArtwork
                    url={artworkUrl}
                    className="absolute inset-0 h-full w-full"
                    style={{
                        backgroundColor: topic?.artworkColor ?? "#111111",
                        opacity: artworkLoading ? 0 : 1,
                    }}
                    onLoad={() => {
                        if (artworkUrl) setLoadedUrl(artworkUrl);
                    }}
                    onError={() => {
                        if (artworkUrl) setFailedUrl(artworkUrl);
                    }}
                    fallback={
                        artworkFailed || (topic && !artworkUrl) ? (
                            <Ionicons
                                name={isArtist ? "person" : "musical-notes"}
                                size={36}
                                color="rgba(255,255,255,0.7)"
                            />
                        ) : null
                    }
                />
                {artworkLoading ? (
                    <View
                        pointerEvents="none"
                        className="absolute inset-0 z-10 items-center justify-center"
                    >
                        <ActivityIndicator color="#ffffff" />
                    </View>
                ) : null}
                <HeroShade artist={isArtist} />
                {topic ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                            isSong
                                ? playing
                                    ? `Pause ${title || "song"}`
                                    : `Play ${title || "song"}`
                                : `View ${title}`
                        }
                        onPress={onArtPress}
                        style={StyleSheet.absoluteFill}
                        className="z-10"
                    >
                        <View
                            className="flex-1 justify-end px-4"
                            style={{
                                paddingBottom: isArtist ? 10 : 14,
                                paddingRight: playing ? 160 : 16,
                            }}
                        >
                            {title ? (
                                <Text
                                    className="text-[22px] font-semibold text-white"
                                    numberOfLines={1}
                                    style={{ letterSpacing: -0.4 }}
                                >
                                    {title}
                                </Text>
                            ) : null}
                            {subtitle ? (
                                <Text
                                    className="text-[13px]"
                                    numberOfLines={1}
                                    style={{
                                        color: "rgba(255,255,255,0.78)",
                                        marginTop: 1,
                                    }}
                                >
                                    {subtitle}
                                </Text>
                            ) : null}
                            {bio ? (
                                <Text
                                    className="text-[13px]"
                                    numberOfLines={3}
                                    style={{
                                        color: "rgba(255,255,255,0.82)",
                                        marginTop: 8,
                                        lineHeight: 18,
                                    }}
                                >
                                    {bio}
                                </Text>
                            ) : null}
                        </View>
                        {isSong ? (
                            <View
                                pointerEvents="none"
                                className="absolute right-4 top-3 z-20"
                            >
                                {loading ? (
                                    <Ionicons
                                        name="ellipsis-horizontal"
                                        size={28}
                                        color="#ffffff"
                                    />
                                ) : (
                                    <Ionicons
                                        name={playing ? "pause" : "play"}
                                        size={28}
                                        color="#ffffff"
                                        style={{ marginLeft: playing ? 0 : 2 }}
                                    />
                                )}
                            </View>
                        ) : null}
                    </Pressable>
                ) : null}
                <Text
                    pointerEvents="none"
                    className="absolute left-4 top-3.5 z-20 text-[11px] font-semibold text-white"
                    style={{ letterSpacing: 0.7 }}
                >
                    {label}
                </Text>
                {playing ? <Visualizer /> : null}
                {playing || (isThisPreview && preview.progress > 0) ? (
                    <ProgressBar ratio={preview.progress} />
                ) : null}
            </View>

            <Pressable
                onPress={onOpenComments}
                disabled={!onOpenComments}
                className="flex-row items-center gap-4 px-4 pb-4 pt-[14px]"
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={liked ? "Unlike post" : "Like post"}
                    accessibilityState={{ selected: liked }}
                    onPress={(event) => {
                        event.stopPropagation();
                        onToggleLike();
                    }}
                    hitSlop={8}
                    className="flex-row items-center gap-1.5 active:opacity-60"
                >
                    <Ionicons
                        name={liked ? "heart" : "heart-outline"}
                        size={18}
                        color={like}
                    />
                    <Text
                        className={cn(
                            "text-sm",
                            liked ? "text-rose-600" : undefined,
                        )}
                        style={liked ? undefined : { color: IDLE }}
                    >
                        {likes}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="View comments"
                    onPress={(event) => {
                        event.stopPropagation();
                        onOpenComments?.();
                    }}
                    disabled={!onOpenComments}
                    hitSlop={8}
                    className="flex-row items-center gap-1.5 active:opacity-60"
                >
                    <Ionicons
                        name="chatbubble-outline"
                        size={18}
                        color={IDLE}
                    />
                    <Text className="text-sm" style={{ color: IDLE }}>
                        {commentCount}
                    </Text>
                </Pressable>
            </Pressable>
        </View>
    );
}

function HeroShade({ artist }: { artist: boolean }) {
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <LinearGradient
                colors={["rgba(0,0,0,0.72)", "rgba(0,0,0,0)"]}
                locations={[0, artist ? 0.36 : 0.42]}
                style={StyleSheet.absoluteFill}
            />
            {artist ? (
                <LinearGradient
                    colors={[
                        "rgba(0,0,0,0)",
                        "rgba(0,0,0,0.28)",
                        "rgba(0,0,0,0.62)",
                    ]}
                    locations={[0.48, 0.78, 1]}
                    style={StyleSheet.absoluteFill}
                />
            ) : (
                <LinearGradient
                    colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.78)"]}
                    locations={[0.45, 1]}
                    style={StyleSheet.absoluteFill}
                />
            )}
        </View>
    );
}

function Visualizer() {
    return (
        <View
            pointerEvents="none"
            className="absolute bottom-1.5 right-4 z-20 flex-row items-end gap-2"
            style={{ height: VIZ_HEIGHT }}
        >
            {BARS.map((bar, index) => (
                <VizBar key={index} {...bar} />
            ))}
        </View>
    );
}

function VizBar({
    ratio,
    opacity,
    duration,
    delay,
}: {
    ratio: number;
    opacity: number;
    duration: number;
    delay: number;
}) {
    const full = VIZ_HEIGHT * ratio;
    const scale = useSharedValue(0.62);
    useEffect(() => {
        if (opacity <= 0) return;
        scale.value = withDelay(
            delay,
            withRepeat(
                withTiming(1, {
                    duration,
                    easing: Easing.inOut(Easing.ease),
                }),
                -1,
                true,
            ),
        );
    }, [delay, duration, opacity, scale]);
    const style = useAnimatedStyle(() => ({
        height: full * scale.value,
    }));
    if (opacity <= 0) return <View style={{ width: 8, height: full }} />;
    return (
        <View style={{ width: 8, height: full, justifyContent: "flex-end" }}>
            <Animated.View
                style={[
                    {
                        width: 8,
                        borderRadius: 999,
                        backgroundColor: `rgba(255,255,255,${opacity})`,
                    },
                    style,
                ]}
            />
        </View>
    );
}

function ProgressBar({ ratio }: { ratio: number }) {
    return (
        <View
            pointerEvents="none"
            className="absolute bottom-0 left-0 right-0 z-20 h-0.5 bg-white/20"
        >
            <View
                className="h-full bg-white"
                style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
            />
        </View>
    );
}
