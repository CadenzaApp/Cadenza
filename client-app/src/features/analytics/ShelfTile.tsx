import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

import { Initials } from "../social/MemberRow";
import { formatCount } from "./format";

/** What a tile draws. A ranking row is one. */
export type ShelfTileRow = {
    rank: number;
    title: string;
    subtitle?: string;
    artworkUrl?: string;
    /** A person's username, drawn as their initials in place of art. */
    initialsOf?: string;
    plays: number;
    onPress: (() => void) | null;
};

/**
 * One shelf's tile: square art (or `art` in its place) with the rank on its
 * corner, then the title, the subtitle and the play count under it. Round art for a dimension drawn round.
 */
export function ShelfTile({
    row,
    width,
    round = false,
    art,
    showTitle = true,
}: {
    row: ShelfTileRow;
    width: number;
    round?: boolean;
    /** Drawn in the square instead of the artwork. */
    art?: ReactNode;
    /** Off when `art` already says what the tile is. */
    showTitle?: boolean;
}) {
    const plays = `${formatCount(row.plays)} plays`;
    const content = (
        <View className="gap-2">
            <View>
                {row.initialsOf ? (
                    <Initials username={row.initialsOf} size={width} />
                ) : art ? (
                    <View
                        className="overflow-hidden rounded-xl"
                        style={{ width, height: width }}
                    >
                        {art}
                    </View>
                ) : (
                    <RemoteArtwork
                        url={row.artworkUrl}
                        className={cn(
                            "bg-secondary",
                            round ? "rounded-full" : "rounded-xl",
                        )}
                        style={{ width, height: width }}
                    />
                )}
                <View className="absolute left-1.5 top-1.5 h-6 min-w-6 items-center justify-center rounded-full bg-black/60 px-1.5">
                    <Text className="text-xs font-bold text-white">
                        {row.rank}
                    </Text>
                </View>
            </View>
            <View className={cn(round && "items-center")}>
                {showTitle ? (
                    <Text className="text-sm font-medium" numberOfLines={1}>
                        {row.title}
                    </Text>
                ) : null}
                {row.subtitle ? (
                    <Text
                        className="text-muted-foreground text-xs"
                        numberOfLines={1}
                    >
                        {row.subtitle}
                    </Text>
                ) : null}
                <Text className="text-muted-foreground text-xs">{plays}</Text>
            </View>
        </View>
    );

    if (!row.onPress) return content;
    return (
        <Pressable
            onPress={row.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${row.rank}. ${row.title}, ${plays}`}
            className="active:opacity-75"
        >
            {content}
        </Pressable>
    );
}
