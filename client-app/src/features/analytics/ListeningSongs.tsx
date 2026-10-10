import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { Text } from "@/components/ui/text";
import { indexTracksById, useTracksForSongIds } from "@/lib/musickit-hooks";
import type { AnalyticsWindow } from "@/lib/routes/analytics";
import {
    useListeningSongs,
    type ListeningTag,
} from "@/lib/routes/analytics-listening";
import { isUsableArtworkUrl } from "@/lib/utils";

import { formatDuration } from "./format";

/** Rows per read, and how many more "Show more" asks for. */
const PAGE = 25;
/** The backend's cap on one read. */
const MAX_LIMIT = 100;

type Props = {
    /** The span the songs are read from, one hour from the heatmap. */
    window: AnalyticsWindow;
    tag: ListeningTag;
    /** The span's label, the sheet's title. */
    title: string;
    onClose: () => void;
};

/** The songs listened to in one span, first played first, as a bottom sheet. */
export function ListeningSongs({ window, tag, title, onClose }: Props) {
    const [limit, setLimit] = useState(PAGE);
    const { data, error, mutate } = useListeningSongs(window, tag, limit);
    const ids = useMemo(
        () => data?.entries.map((song) => song.song_id) ?? [],
        [data],
    );
    const { tracks } = useTracksForSongIds(ids);
    const byId = useMemo(() => indexTracksById(tracks), [tracks]);

    return (
        <ModalPopup
            visible
            onClose={onClose}
            title={title}
            backdropClassName="justify-end px-0 pb-0"
            contentStyle={{ width: "100%", maxWidth: 500, maxHeight: "75%" }}
        >
            <ScrollView contentContainerClassName="gap-3 pb-2">
                {!data ? (
                    error ? (
                        <Pressable
                            className="min-h-11 justify-center"
                            onPress={() => void mutate()}
                            accessibilityRole="button"
                        >
                            <Text className="text-muted-foreground text-sm">
                                Could not load. Tap to retry.
                            </Text>
                        </Pressable>
                    ) : (
                        <Text className="text-muted-foreground py-3 text-sm">
                            Loading...
                        </Text>
                    )
                ) : null}
                {data?.entries.length === 0 ? (
                    <Text className="text-muted-foreground py-3 text-sm">
                        Nothing played.
                    </Text>
                ) : null}
                {data?.entries.map((song) => {
                    const track = byId.get(song.song_id);
                    return (
                        <View
                            key={song.song_id}
                            className="flex-row items-center gap-3"
                        >
                            {isUsableArtworkUrl(track?.artworkUrl) ? (
                                <Image
                                    source={{ uri: track!.artworkUrl }}
                                    className="h-10 w-10 rounded"
                                />
                            ) : (
                                <View className="h-10 w-10 rounded bg-muted" />
                            )}
                            <View className="flex-1">
                                <Text className="text-sm" numberOfLines={1}>
                                    {track?.title ?? "Unknown song"}
                                </Text>
                                <Text
                                    className="text-muted-foreground text-xs"
                                    numberOfLines={1}
                                >
                                    {track?.artistName ?? ""}
                                </Text>
                            </View>
                            <Text className="text-muted-foreground text-sm">
                                {formatDuration(song.listening_ms)}
                            </Text>
                        </View>
                    );
                })}
                {data?.has_more && limit < MAX_LIMIT ? (
                    <Pressable
                        className="h-11 items-center justify-center active:opacity-60"
                        accessibilityRole="button"
                        onPress={() =>
                            setLimit((n) => Math.min(MAX_LIMIT, n + PAGE))
                        }
                    >
                        <Text className="text-sm">Show more</Text>
                    </Pressable>
                ) : null}
            </ScrollView>
        </ModalPopup>
    );
}
