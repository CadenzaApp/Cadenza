import Ionicons from "@expo/vector-icons/Ionicons";
import {
    RepeatMode,
    ShuffleMode,
    type MusicItem,
    type SongFavoriteStatus,
} from "@apple-musickit";
import {
    Image,
    Pressable,
    StyleSheet,
    View,
    type ColorValue,
} from "react-native";

import { ReorderableList } from "@/components/custom/reorderable-list";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";

import { MediaPlayerTrackHeading } from "./playback-details";

/** Row height the reorderable list positions against. */
const QUEUE_ROW_HEIGHT = 60;
/** Height of the two mode pills, and so their radius. */
const MODE_PILL_HEIGHT = 44;
/** What the on state inverts to: a solid white pill with a dark glyph. */
const MODE_PILL_ACTIVE_BG = "#ffffff";
const MODE_PILL_ACTIVE_FG = "#000000";

type MediaPlayerQueueProps = {
    track: MusicItem;
    /** Everything queued after the song that is playing, in order. */
    upcoming: MusicItem[];
    shuffleMode: ShuffleMode;
    repeatMode: RepeatMode;
    favoriteStatus: SongFavoriteStatus | null | undefined;
    isFavoriteStatusLoading: boolean;
    isUpdatingFavorite: boolean;
    textColor: ColorValue;
    onFavoriteToggle: () => void;
    onOpenMenu: () => void;
    onToggleShuffle: () => void;
    onCycleRepeat: () => void;
    /** Positions address the upcoming list, not the whole queue. */
    onPlayUpcoming: (upcomingIndex: number) => void;
    onRemoveUpcoming: (upcomingIndex: number) => void;
    onMoveUpcoming: (
        fromUpcomingIndex: number,
        toUpcomingIndex: number,
    ) => void;
};

/**
 * What the now playing sheet shows in place of the artwork once the queue
 * button is on: the song that is playing as a compact heading, the two playback
 * modes, and everything queued behind it.
 *
 * Positions here are upcoming-list positions. The playing entry is not in this
 * list and cannot be dragged, removed, or jumped to, so the caller converts
 * before it touches the real queue.
 */
export function MediaPlayerQueue({
    track,
    upcoming,
    shuffleMode,
    repeatMode,
    favoriteStatus,
    isFavoriteStatusLoading,
    isUpdatingFavorite,
    textColor,
    onFavoriteToggle,
    onOpenMenu,
    onToggleShuffle,
    onCycleRepeat,
    onPlayUpcoming,
    onRemoveUpcoming,
    onMoveUpcoming,
}: MediaPlayerQueueProps) {
    const shuffleOn = shuffleMode !== ShuffleMode.Off;
    const repeatOn = repeatMode !== RepeatMode.Off;

    return (
        <View className="flex-1">
            <MediaPlayerTrackHeading
                track={track}
                favoriteStatus={favoriteStatus}
                isFavoriteStatusLoading={isFavoriteStatusLoading}
                isUpdatingFavorite={isUpdatingFavorite}
                textColor={textColor}
                compact
                onFavoriteToggle={onFavoriteToggle}
                onOpenMenu={onOpenMenu}
            />

            <View className="mt-3 flex-row gap-2">
                <ModePill
                    label="Shuffle"
                    icon="shuffle"
                    active={shuffleOn}
                    textColor={textColor}
                    onPress={onToggleShuffle}
                />
                <ModePill
                    label={repeatLabel(repeatMode)}
                    icon={
                        repeatMode === RepeatMode.One
                            ? "repeat-outline"
                            : "repeat"
                    }
                    badge={repeatMode === RepeatMode.One ? "1" : undefined}
                    active={repeatOn}
                    textColor={textColor}
                    onPress={onCycleRepeat}
                />
            </View>

            <Text className="mb-1 mt-4 text-xl font-bold text-foreground">
                Continue Playing
            </Text>

            <ReorderableList
                style={{ flex: 1 }}
                data={upcoming}
                itemHeight={QUEUE_ROW_HEIGHT}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                onReorder={onMoveUpcoming}
                empty={
                    <Text className="py-8 text-center text-muted-foreground">
                        Nothing else is queued.
                    </Text>
                }
                renderItem={({ item, index }) => (
                    <QueueRow
                        track={item}
                        textColor={textColor}
                        onPress={() => onPlayUpcoming(index)}
                        onRemove={() => onRemoveUpcoming(index)}
                    />
                )}
            />
        </View>
    );
}

function repeatLabel(mode: RepeatMode) {
    if (mode === RepeatMode.One) return "Repeat One";
    if (mode === RepeatMode.All) return "Repeat";
    return "Repeat";
}

/**
 * One of the two playback mode toggles. Off it is glass, like every other
 * floating control in the app. On it inverts to a solid white pill with a dark
 * glyph, so the state reads at a glance rather than from a tint difference.
 */
function ModePill({
    label,
    icon,
    badge,
    active,
    textColor,
    onPress,
}: {
    label: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    badge?: string;
    active: boolean;
    textColor: ColorValue;
    onPress: () => void;
}) {
    const foreground = active ? MODE_PILL_ACTIVE_FG : textColor;

    // The width lives on a wrapper: a nativewind class and a `style` function
    // on the same pressable fight, and putting the `flex: 1` inside the
    // function instead leaves the pill sized to its icon. Same split the glass
    // icon button uses.
    return (
        <View className="flex-1">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: active }}
                onPress={onPress}
                style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
                <View
                    className="flex-row items-center justify-center gap-1 border border-border"
                    style={{
                        height: MODE_PILL_HEIGHT,
                        borderRadius: MODE_PILL_HEIGHT / 2,
                        overflow: "hidden",
                        backgroundColor: active
                            ? MODE_PILL_ACTIVE_BG
                            : "transparent",
                    }}
                >
                    {/* Off only. The glass layer is a plain view away from the
                    touch path, and the solid on state has nothing to show
                    through it anyway. */}
                    {active ? null : (
                        <View
                            pointerEvents="none"
                            style={StyleSheet.absoluteFill}
                        >
                            <GlassSurface
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        borderRadius: MODE_PILL_HEIGHT / 2 - 1,
                                        overflow: "hidden",
                                    },
                                ]}
                            />
                        </View>
                    )}
                    <Ionicons name={icon} size={20} color={foreground} />
                    {badge ? (
                        <Text
                            className="text-xs font-bold"
                            style={{ color: foreground }}
                        >
                            {badge}
                        </Text>
                    ) : null}
                </View>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    pressed: { opacity: 0.65 },
});

function QueueRow({
    track,
    textColor,
    onPress,
    onRemove,
}: {
    track: MusicItem;
    textColor: ColorValue;
    onPress: () => void;
    onRemove: () => void;
}) {
    const artworkUrl = track.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" && /^https?:\/\//i.test(artworkUrl);

    return (
        <View className="flex-1 flex-row items-center gap-3 pr-1">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Play ${track.title}`}
                onPress={onPress}
                className="h-full flex-1 flex-row items-center gap-3 active:opacity-60"
            >
                {canRenderArtwork ? (
                    <Image
                        source={{ uri: artworkUrl }}
                        className="h-11 w-11 rounded bg-muted"
                    />
                ) : (
                    <View className="h-11 w-11 items-center justify-center rounded bg-muted">
                        <Ionicons
                            name="musical-notes"
                            size={18}
                            color={textColor}
                        />
                    </View>
                )}
                <View className="flex-1">
                    <Text
                        className="text-base font-semibold text-foreground"
                        numberOfLines={1}
                    >
                        {track.title || "Unknown Title"}
                    </Text>
                    <Text
                        className="text-sm text-muted-foreground"
                        numberOfLines={1}
                    >
                        {track.artistName || "Unknown Artist"}
                    </Text>
                </View>
            </Pressable>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${track.title} from the queue`}
                onPress={onRemove}
                hitSlop={8}
                className="h-11 w-9 items-center justify-center active:opacity-60"
            >
                <Ionicons name="close" size={20} color={textColor} />
            </Pressable>
            {/* Decoration. The whole row is the drag target, so a handle that
                only worked when grabbed here would be a smaller target for no
                reason. */}
            <View className="w-6 items-center justify-center">
                <Ionicons name="reorder-three" size={22} color={textColor} />
            </View>
        </View>
    );
}
