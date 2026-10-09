import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/text";
import { darken, withAlpha } from "@/lib/artwork-color";
import { indexTracksById, useTracksForSongIds } from "@/lib/musickit-hooks";
import type { TagPlayCount } from "@/lib/routes/analytics";
import { isUsableArtworkUrl } from "@/lib/utils";
import { useOpenScreen } from "@/lib/open-screen";

import { formatCount } from "./format";
import { SectionHeading } from "./SectionHeading";

const TILE_SIZE = 150;
/** Darkens the bottom of a tile so the white name reads on any cover. */
const SCRIM = ["transparent", "rgba(0,0,0,0.75)"] as const;

/**
 * The tags the user played this period, as a sideways rail of square tiles.
 * Each tile is the cover of the tag's most played song, or the tag's own color
 * when that song has no artwork. Tapping one opens the tag.
 *
 * Bleeds to the screen edges, so it sits outside the page's side padding and
 * pads its own content back in.
 */
export function TagRotation({ tags }: { tags: readonly TagPlayCount[] }) {
    const songIds = useMemo(
        () => tags.map((tag) => tag.sample_song_id),
        [tags],
    );
    const { tracks } = useTracksForSongIds(songIds);
    const tracksById = useMemo(() => indexTracksById(tracks), [tracks]);

    return (
        <View className="gap-3">
            <SectionHeading
                title="Your tags in rotation"
                detail="Songs can have more than one tag."
                href="/analytics/tags"
            />
            {tags.length === 0 ? (
                <Text className="text-muted-foreground text-sm">
                    Tag some songs and play them to see this.
                </Text>
            ) : (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="-mx-5"
                    contentContainerClassName="gap-3 px-5"
                >
                    {tags.map((tag) => (
                        <TagTile
                            key={tag.id}
                            tag={tag}
                            artworkUrl={
                                tracksById.get(tag.sample_song_id)?.artworkUrl
                            }
                        />
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

function TagTile({
    tag,
    artworkUrl,
}: {
    tag: TagPlayCount;
    artworkUrl?: string;
}) {
    const openScreen = useOpenScreen();
    const hasCover = isUsableArtworkUrl(artworkUrl);

    return (
        <Pressable
            onPress={() =>
                openScreen({
                    pathname: "/tag/[tagId]",
                    params: { tagId: tag.id },
                })
            }
            accessibilityRole="button"
            accessibilityLabel={`${tag.name}, ${formatCount(tag.plays)} plays`}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
            <View
                className="overflow-hidden rounded-2xl border"
                style={{
                    width: TILE_SIZE,
                    height: TILE_SIZE,
                    borderColor: withAlpha(tag.color, 0.6),
                }}
            >
                {hasCover ? (
                    <Image
                        source={{ uri: artworkUrl?.trim() }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={200}
                    />
                ) : (
                    <LinearGradient
                        colors={[tag.color, darken(tag.color, 0.35)]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                    />
                )}
                <LinearGradient
                    colors={SCRIM}
                    start={{ x: 0, y: 0.35 }}
                    end={{ x: 0, y: 1 }}
                    style={StyleSheet.absoluteFill}
                />
                <View className="flex-1 justify-end p-3">
                    <Text
                        className="text-xl font-bold text-white"
                        numberOfLines={2}
                    >
                        {tag.name}
                    </Text>
                    <Text className="text-xs text-white/80">
                        {formatCount(tag.plays)} plays
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    pressed: { opacity: 0.75 },
});
