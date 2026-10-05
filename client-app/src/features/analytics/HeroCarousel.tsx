import type { MusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    type SharedValue,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { indexTracksById, useTracksForSongIds } from "@/lib/musickit-hooks";
import { usePlaybackCommands } from "@/lib/playback";
import type { EntityPlayCount } from "@/lib/routes/analytics";
import { isUsableArtworkUrl } from "@/lib/utils";

import { albumRouteFor } from "./dimensions";
import { formatCount } from "./format";

/** How many covers the carousel holds. */
const HERO_COUNT = 3;
const COVER_SIZE = 220;
/** How far a side cover sits from the center, as a share of a cover. */
const SIDE_OFFSET = 0.6;
const SIDE_SCALE = 0.72;
const SIDE_TILT_DEG = 8;
/** A horizontal swipe longer than this moves one cover. */
const SWIPE_DISTANCE = 12;
/** A flick faster than this moves one cover, however short it was. */
const FLICK_VELOCITY = 120;
/** How far a finger drags for the covers to move one place. */
const DRAG_PER_COVER = COVER_SIZE * SIDE_OFFSET;
const SNAP = { damping: 18, stiffness: 160 };

type Props = {
    /** The period's song ranking, most played first. */
    songs: readonly EntityPlayCount[];
    /** "this week", for the "YOUR #1 THIS WEEK" line. */
    phrase: string;
    accent: string | null;
};

/**
 * The period's top songs as a fan of covers, the selected one large in the
 * middle and its neighbours tilted behind it. Swipe or tap a side cover to
 * bring it forward. Play starts the top songs from the selected one.
 */
export function HeroCarousel({ songs, phrase, accent }: Props) {
    const router = useRouter();
    const { colors } = useTheme();
    const { playQueue } = usePlaybackCommands();
    const entries = useMemo(() => songs.slice(0, HERO_COUNT), [songs]);
    const songIds = useMemo(
        () => entries.map((entry) => entry.sample_song_id),
        [entries],
    );
    const { tracks } = useTracksForSongIds(songIds);
    const tracksById = useMemo(() => indexTracksById(tracks), [tracks]);

    // the caller keys this by period, so a new period starts back at #1
    const [chosen, setChosen] = useState(0);
    const last = entries.length - 1;
    // a revalidated ranking can come back shorter than the held index
    const selected = Math.max(0, Math.min(chosen, last));
    const active = useSharedValue(0);

    useEffect(() => {
        active.set(withSpring(selected, SNAP));
    }, [active, selected]);

    // the covers follow the finger, then settle on whichever one the swipe
    // reached. a short drag or a quick flick both count, so a small fast swipe
    // moves one cover. runs on the UI thread, so the drag does not lag the
    // finger while JS is busy
    const swipe = Gesture.Pan()
        // horizontal wins early, and a vertical drag has to be clearly
        // vertical to fail it, so the page still scrolls under one
        .activeOffsetX([-6, 6])
        .failOffsetY([-24, 24])
        .onUpdate((event) => {
            const dragged = selected - event.translationX / DRAG_PER_COVER;
            // past either end it stretches a little rather than stopping dead
            const clamped = Math.max(-0.3, Math.min(last + 0.3, dragged));
            active.set(clamped);
        })
        .onEnd((event) => {
            const forward =
                event.translationX < -SWIPE_DISTANCE ||
                event.velocityX < -FLICK_VELOCITY;
            const back =
                event.translationX > SWIPE_DISTANCE ||
                event.velocityX > FLICK_VELOCITY;
            const next = forward
                ? Math.min(last, selected + 1)
                : back
                  ? Math.max(0, selected - 1)
                  : selected;
            runOnJS(setChosen)(next);
            // the effect only fires on a change, so a swipe that lands back
            // where it started has to settle here
            active.set(withSpring(next, SNAP));
        })
        .onFinalize((_, success) => {
            if (!success) active.set(withSpring(selected, SNAP));
        });

    const entry = entries[selected];
    if (!entry) return null;
    const track = tracksById.get(entry.sample_song_id);
    const album = albumRouteFor(entry, track);

    async function play() {
        if (!track) return;
        await playQueue({
            tracks,
            startIndex: Math.max(0, tracks.indexOf(track)),
        });
    }

    return (
        <View className="items-center gap-4">
            <GestureDetector gesture={swipe}>
                <View
                    style={{ height: COVER_SIZE + 12 }}
                    className="w-full items-center justify-center"
                >
                    {entries.map((row, index) => (
                        <Cover
                            key={row.key}
                            index={index}
                            active={active}
                            track={tracksById.get(row.sample_song_id)}
                            onPress={() => setChosen(index)}
                        />
                    ))}
                </View>
            </GestureDetector>

            <View className="items-center gap-1 px-4">
                <Text
                    className="text-muted-foreground text-xs font-semibold uppercase tracking-[2px]"
                    style={accent ? { color: accent } : null}
                >
                    Your #{selected + 1} {phrase}
                </Text>
                <Text
                    className="text-center text-3xl font-bold tracking-tight"
                    numberOfLines={2}
                >
                    {track?.title ?? entry.label ?? "Unknown song"}
                </Text>
                <Text
                    className="text-muted-foreground text-center text-sm"
                    numberOfLines={1}
                >
                    {[track?.artistName, `${formatCount(entry.plays)} plays`]
                        .filter(Boolean)
                        .join(" - ")}
                </Text>
            </View>

            <View className="flex-row gap-3">
                <Pressable
                    onPress={() => void play()}
                    disabled={!track}
                    accessibilityRole="button"
                    accessibilityLabel={`Play ${track?.title ?? "song"}`}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}
                >
                    <View className="h-12 flex-row items-center gap-2 rounded-full bg-foreground px-8">
                        <Ionicons
                            name="play"
                            size={18}
                            color={colors.background}
                        />
                        <Text className="text-base font-semibold text-background">
                            Play
                        </Text>
                    </View>
                </Pressable>
                {album ? (
                    <Pressable
                        onPress={() => router.push(album)}
                        accessibilityRole="button"
                        accessibilityLabel="View album"
                        style={({ pressed }) =>
                            pressed ? styles.pressed : null
                        }
                    >
                        <View className="h-12 flex-row items-center gap-1 overflow-hidden rounded-full border border-border px-6">
                            <View
                                pointerEvents="none"
                                style={StyleSheet.absoluteFill}
                            >
                                <GlassSurface style={StyleSheet.absoluteFill} />
                            </View>
                            <Text className="text-base font-medium">
                                View album
                            </Text>
                            <Ionicons
                                name="chevron-forward"
                                size={16}
                                color={colors.text}
                            />
                        </View>
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

/**
 * One cover, placed by how far it is from the selected one. Reads the spring
 * rather than the index, so a change animates every cover at once.
 */
function Cover({
    index,
    active,
    track,
    onPress,
}: {
    index: number;
    active: SharedValue<number>;
    track?: MusicItem;
    onPress: () => void;
}) {
    const style = useAnimatedStyle(() => {
        const offset = index - active.get();
        const distance = Math.abs(offset);
        return {
            zIndex: Math.round(10 - distance * 2),
            opacity: interpolate(distance, [0, 1, 2], [1, 0.85, 0]),
            transform: [
                {
                    translateX: interpolate(
                        offset,
                        [-1, 0, 1],
                        [
                            -COVER_SIZE * SIDE_OFFSET,
                            0,
                            COVER_SIZE * SIDE_OFFSET,
                        ],
                        "extend",
                    ),
                },
                {
                    scale: interpolate(
                        distance,
                        [0, 1],
                        [1, SIDE_SCALE],
                        "clamp",
                    ),
                },
                {
                    rotate: `${interpolate(offset, [-1, 0, 1], [-SIDE_TILT_DEG, 0, SIDE_TILT_DEG], "clamp")}deg`,
                },
            ],
        };
    });

    const url = track?.artworkUrlLarge ?? track?.artworkUrl;

    return (
        <Animated.View
            style={[
                {
                    position: "absolute",
                    width: COVER_SIZE,
                    height: COVER_SIZE,
                },
                styles.shadow,
                style,
            ]}
        >
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={track?.title ?? "Song cover"}
                className="flex-1 overflow-hidden rounded-2xl bg-muted"
            >
                {isUsableArtworkUrl(url) ? (
                    <Image
                        source={{ uri: url?.trim() }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={200}
                    />
                ) : null}
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    pressed: { opacity: 0.7 },
    shadow: {
        shadowColor: "#000",
        shadowOpacity: 0.45,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
    },
});
