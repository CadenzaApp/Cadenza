import Ionicons from "@expo/vector-icons/Ionicons";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState, type ReactNode } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
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
import type { PostTopic, SocialPostTag } from "@/lib/types";
import { PostTagRow } from "./PostTags";
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
/** Gap between the visualizer and whatever it sits on. */
const VIZ_GAP = 6;
/** Like and comment counts, read against the shade over the artwork. */
const IDLE = "rgba(255,255,255,0.85)";
/** How far in from each edge the artwork fades to transparent. */
const EDGE_BLUR = 15;
/** The card's corner radius, `rounded-3xl`. The edge fade follows it. */
const CARD_RADIUS = 24;

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
    /** The shared post's tags, shown along the bottom of the cover. */
    tags?: SocialPostTag[];
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
 * catalog has one. The artwork fills the whole card, like bar included, under
 * a shade that darkens toward the bottom, and fades out at the border.
 * The post's tags sit along the bottom of the cover, under the name, in a row
 * that scrolls sideways and fades out at both ends. Tapping a tag does
 * nothing. The visualizer sits above them.
 */
export function SpotlightPost({
    topic,
    cardId,
    liked,
    likes,
    commentCount,
    tags,
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
    const [tagsHeight, setTagsHeight] = useState(0);
    const hasTags = Boolean(tags && tags.length > 0);
    const heroPaddingBottom = isArtist ? 10 : 14;
    // the name and bio sit above the tags row, which is laid over the cover
    const textPaddingBottom = hasTags
        ? heroPaddingBottom + tagsHeight + 8
        : heroPaddingBottom;
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
        <View className="overflow-hidden rounded-3xl">
            <SoftEdges>
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
                <HeroShade artist={isArtist} />
            </SoftEdges>
            <View
                className="relative"
                style={{ height: isArtist ? ART_ARTIST : ART_SONG }}
            >
                {artworkLoading ? (
                    <View
                        pointerEvents="none"
                        className="absolute inset-0 z-10 items-center justify-center"
                    >
                        <ActivityIndicator color="#ffffff" />
                    </View>
                ) : null}
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
                            className="flex-1 justify-end"
                            style={{ paddingBottom: textPaddingBottom }}
                        >
                            <View
                                className="px-4"
                                style={{ paddingRight: playing ? 160 : 16 }}
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
                {hasTags ? (
                    // a sibling over the cover, not inside its Pressable, so a
                    // tap on a tag does not play the song or open the artist
                    // style, not className: NativeWind does not reach MaskedView
                    <MaskedView
                        style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: heroPaddingBottom,
                            zIndex: 20,
                        }}
                        onLayout={(event) =>
                            setTagsHeight(event.nativeEvent.layout.height)
                        }
                        maskElement={<SideFadeMask />}
                    >
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{ paddingHorizontal: 16 }}
                            style={{ flexGrow: 0 }}
                        >
                            <PostTagRow tags={tags} compact />
                        </ScrollView>
                    </MaskedView>
                ) : null}
                <Text
                    pointerEvents="none"
                    className="absolute left-4 top-3.5 z-20 text-[11px] font-semibold text-white"
                    style={{ letterSpacing: 0.7 }}
                >
                    {label}
                </Text>
                {playing ? (
                    <Visualizer
                        bottom={
                            hasTags
                                ? heroPaddingBottom + tagsHeight + VIZ_GAP
                                : VIZ_GAP
                        }
                    />
                ) : null}
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
                        className="text-sm"
                        style={{ color: liked ? like : IDLE }}
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

/**
 * The shade over the whole card: dark at the top for the label, and darker
 * toward the bottom so the name, tags, and like and comment counts stay
 * readable on the artwork.
 */
function HeroShade({ artist }: { artist: boolean }) {
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <LinearGradient
                colors={["rgba(0,0,0,0.72)", "rgba(0,0,0,0)"]}
                locations={[0, artist ? 0.3 : 0.34]}
                style={StyleSheet.absoluteFill}
            />
            <LinearGradient
                colors={[
                    "rgba(0,0,0,0)",
                    "rgba(0,0,0,0.45)",
                    "rgba(0,0,0,0.86)",
                ]}
                locations={artist ? [0.4, 0.68, 1] : [0.34, 0.62, 1]}
                style={StyleSheet.absoluteFill}
            />
        </View>
    );
}

/**
 * A rounded rect that goes from clear at the card's border to opaque
 * `EDGE_BLUR` in, following the corners. Built from one-pixel steps, each a
 * rounded rect one pixel further in, whose opacities stack to a straight ramp.
 */
function RoundedFadeMask() {
    return (
        <View style={StyleSheet.absoluteFill}>
            {Array.from({ length: EDGE_BLUR }, (_, step) => (
                <View
                    key={step}
                    style={{
                        position: "absolute",
                        top: step,
                        bottom: step,
                        left: step,
                        right: step,
                        borderRadius: Math.max(CARD_RADIUS - step, 0),
                        backgroundColor: "black",
                        // step k of n stacks to (k + 1) / n
                        opacity: 1 / (EDGE_BLUR - step),
                    }}
                />
            ))}
        </View>
    );
}

/** Clear at the left and right ends, so scrolled tags fade out at the edges. */
function SideFadeMask() {
    return (
        <View style={[StyleSheet.absoluteFill, { flexDirection: "row" }]}>
            <LinearGradient
                colors={["transparent", "black"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ width: EDGE_BLUR }}
            />
            <View style={{ flex: 1, backgroundColor: "black" }} />
            <LinearGradient
                colors={["black", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ width: EDGE_BLUR }}
            />
        </View>
    );
}

/**
 * The artwork layer, faded to transparent along the card's border so the
 * card's edge is soft over whatever is behind it.
 */
function SoftEdges({ children }: { children: ReactNode }) {
    return (
        <MaskedView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            maskElement={<RoundedFadeMask />}
        >
            {children}
        </MaskedView>
    );
}

/** `bottom` is the offset from the cover's bottom edge, above the tags when there are any. */
function Visualizer({ bottom }: { bottom: number }) {
    return (
        <View
            pointerEvents="none"
            className="absolute right-4 z-20 flex-row items-end gap-2"
            style={{ height: VIZ_HEIGHT, bottom }}
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
