import { Pressable, View } from "react-native";

import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { Text } from "@/components/ui/text";
import type { EntityPlayCount } from "@/lib/routes/analytics";

import { Initials } from "../social/MemberRow";
import type { DimensionDescriptor } from "./dimensions";
import { formatCount } from "./format";
import { useRankedRows } from "./use-ranked-rows";

type Props = {
    dimension: DimensionDescriptor;
    entries: readonly EntityPlayCount[];
};

/**
 * A ranked list of whatever a dimension ranks, with play counts. Rows come
 * from `useRankedRows`, which owns the artwork and what a tap does.
 *
 * Used for every full ranking but songs, which gets a `MusicList` with options
 * menus and tag rails.
 */
export function TopEntityList({ dimension, entries }: Props) {
    const rows = useRankedRows(dimension, entries);

    if (rows.length === 0) {
        return (
            <Text className="text-muted-foreground text-sm">
                {dimension.emptyLabel}
            </Text>
        );
    }

    return (
        <View className="gap-3">
            {rows.map((row) => {
                const content = (
                    <View className="flex-row items-center gap-3">
                        <Text className="text-muted-foreground w-4 text-xs">
                            {row.rank}
                        </Text>
                        {row.initialsOf ? (
                            <Initials
                                username={row.initialsOf}
                                size={ARTWORK_SIZE}
                            />
                        ) : (
                            <Artwork
                                url={row.artworkUrl}
                                round={dimension.roundArtwork}
                            />
                        )}
                        <View className="flex-1">
                            <Text className="text-sm" numberOfLines={1}>
                                {row.title}
                            </Text>
                            {row.subtitle ? (
                                <Text
                                    className="text-muted-foreground text-xs"
                                    numberOfLines={1}
                                >
                                    {row.subtitle}
                                </Text>
                            ) : null}
                        </View>
                        <Text className="text-sm font-medium">
                            {formatCount(row.plays)}
                        </Text>
                    </View>
                );

                if (!row.onPress) return <View key={row.key}>{content}</View>;

                return (
                    <Pressable
                        key={row.key}
                        onPress={row.onPress}
                        accessibilityRole="button"
                        accessibilityLabel={`${row.title}, ${formatCount(row.plays)} plays`}
                    >
                        {content}
                    </Pressable>
                );
            })}
        </View>
    );
}

const ARTWORK_SIZE = 40;

/** The same placeholder the music list rows use. */
function Artwork({ url, round }: { url?: string; round?: boolean }) {
    return (
        <RemoteArtwork
            url={url}
            className={round ? "rounded-full" : "rounded"}
            style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }}
        />
    );
}
