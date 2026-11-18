import { useMemo } from "react";
import { View } from "react-native";

import { PeekCarousel } from "@/components/custom/peek-carousel";
import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import { withAlpha } from "@/lib/artwork-color";
import { useOpenScreen } from "@/lib/open-screen";
import type { TagPlayCount } from "@/lib/routes/analytics";

import { SectionHeading } from "./SectionHeading";
import { ShelfTile, type ShelfTileRow } from "./ShelfTile";
import { SHELF_COUNT } from "./TopShelves";

/** How far the tag leans across its tile. */
const TAG_TILT = "-20deg";

/**
 * The tags the user played this period, as the top shelf: the top five as
 * tiles, the same tile every ranking shelf uses, and "See all" for the rest.
 * Each tile is the tag itself, tilted across a wash of its color, with its
 * plays underneath. Tapping one opens the tag.
 */
export function TagRotation({ tags }: { tags: readonly TagPlayCount[] }) {
    const openScreen = useOpenScreen();
    const rows = useMemo(
        () =>
            tags
                .slice(0, SHELF_COUNT)
                .map((tag, index): ShelfTileRow & { tag: TagPlayCount } => ({
                    tag,
                    rank: index + 1,
                    title: tag.name,
                    plays: tag.plays,
                    onPress: () =>
                        openScreen({
                            pathname: "/tag/[tagId]",
                            params: { tagId: tag.id },
                        }),
                })),
        [tags, openScreen],
    );

    return (
        <View className="gap-3">
            <SectionHeading
                title="Most Played Tags"
                detail="Songs can have more than one tag."
                href="/analytics/tags"
            />
            {rows.length === 0 ? (
                <Text className="text-muted-foreground text-sm">
                    Tag some songs and play them to see this.
                </Text>
            ) : (
                <PeekCarousel
                    items={rows}
                    keyOf={(row) => String(row.tag.id)}
                    renderItem={(row, width) => (
                        <ShelfTile
                            row={row}
                            width={width}
                            showTitle={false}
                            art={<TiltedTag tag={row.tag} width={width} />}
                        />
                    )}
                />
            )}
        </View>
    );
}

/** The tag pill, tilted, centered on a faint wash and rim of its own color. */
function TiltedTag({ tag, width }: { tag: TagPlayCount; width: number }) {
    return (
        <View
            className="flex-1 items-center justify-center rounded-xl border"
            style={{
                backgroundColor: withAlpha(tag.color, 0.15),
                borderColor: withAlpha(tag.color, 0.6),
            }}
        >
            <View
                style={{
                    maxWidth: width * 1.2,
                    transform: [{ rotate: TAG_TILT }],
                }}
            >
                <TagPill tag={tag} height={width * 0.12} />
            </View>
        </View>
    );
}
