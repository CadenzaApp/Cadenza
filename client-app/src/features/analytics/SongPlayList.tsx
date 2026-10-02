import { useMemo } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { useTracksForSongIds } from "@/lib/musickit-hooks";

export type SongRow = {
    songId: string;
    /** The right hand figure, already formatted. */
    value: string;
};

type Props = {
    rows: SongRow[];
    /** Shown when there is nothing to list. */
    emptyLabel: string;
};

/**
 * A ranked list of songs with one figure each.
 *
 * The backend only ever has song ids, since Apple Music owns the metadata, so the
 * titles are read here. A song whose metadata will not load still lists, by id,
 * rather than dropping out of a ranking it earned.
 */
export function SongPlayList({ rows, emptyLabel }: Props) {
    const songIds = useMemo(() => rows.map((row) => row.songId), [rows]);
    const { tracks } = useTracksForSongIds(songIds);

    // tracks come back without the ones that did not resolve, so index rather
    // than zip: the nth row is not the nth track
    const tracksById = useMemo(() => {
        const byId = new Map<string, (typeof tracks)[number]>();
        for (const track of tracks) {
            for (const id of [track.id, track.catalogId, track.libraryId]) {
                if (id) byId.set(id, track);
            }
        }
        return byId;
    }, [tracks]);

    if (rows.length === 0) {
        return (
            <Text className="text-muted-foreground text-sm">{emptyLabel}</Text>
        );
    }

    return (
        <View className="gap-3">
            {rows.map((row, index) => {
                const track = tracksById.get(row.songId);
                return (
                    <View
                        key={row.songId}
                        className="flex-row items-center gap-3"
                    >
                        <Text className="text-muted-foreground w-5 text-xs">
                            {index + 1}
                        </Text>
                        <View className="flex-1">
                            <Text className="text-sm" numberOfLines={1}>
                                {track?.title ?? row.songId}
                            </Text>
                            {track?.artistName ? (
                                <Text
                                    className="text-muted-foreground text-xs"
                                    numberOfLines={1}
                                >
                                    {track.artistName}
                                </Text>
                            ) : null}
                        </View>
                        <Text className="text-sm font-medium">{row.value}</Text>
                    </View>
                );
            })}
        </View>
    );
}
