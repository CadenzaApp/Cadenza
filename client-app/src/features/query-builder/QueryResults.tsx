import type { MusicItem } from "@apple-musickit";
import { useCallback, useState } from "react";
import { useWindowDimensions, View } from "react-native";

import { TrackCollectionView } from "@/components/custom/track-collection-view";
import { useCollectionArtworkTint } from "@/components/custom/use-collection-artwork-tint";
import { ModalPopup } from "@/components/custom/modal-popup";
import { FloatingCloseButton } from "@/components/ui/floating-close-button";
import { GlassButton } from "@/components/ui/glass-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useListeningEvents } from "@/lib/listening-events";
import { usePlaybackCommands } from "@/lib/playback";

const HERO_BUTTON_SIZE = 52;

type Props = {
    songs: MusicItem[];
    isLoading: boolean;
    error?: unknown;
    anticipatedTrackCount?: number;
    mostRelevantTags?: readonly string[];
    /** The activity tags the query filters on, shown on every row. */
    activityTagIds?: readonly number[];
};

export default function QueryResults({
    songs,
    isLoading,
    error,
    anticipatedTrackCount,
    mostRelevantTags,
    activityTagIds,
}: Props) {
    const { width: screenWidth } = useWindowDimensions();
    const [saveOpen, setSaveOpen] = useState(false);
    const [saveName, setSaveName] = useState("");
    const { tint, artworkUrls } = useCollectionArtworkTint(songs);
    const { recordEvent } = useListeningEvents();
    const { playQueue, togglePlayback } = usePlaybackCommands();
    const saveDialogWidth = Math.round(screenWidth * 0.75);

    /**
     * Notes that a song was played out of this query, which is what the query
     * play rate is built from. Only the song that starts playing is recorded:
     * the rest of the queue is also from the query, but nothing tracks where a
     * running queue came from, so counting them would be a guess.
     */
    const recordQueryPlay = useCallback(
        (track: MusicItem) => {
            // the id tags cross the api under, the same key the rest of the app
            // reads a song's tags with
            const songId = track.catalogId ?? track.id;
            void recordEvent("query_play", songId, {
                result_count: songs.length,
            }).catch(() => {
                // a lost event is not worth interrupting playback over
            });
        },
        [recordEvent, songs.length],
    );

    const playFromTop = useCallback(async () => {
        if (songs.length === 0) return;
        recordQueryPlay(songs[0]);
        await playQueue({ tracks: songs });
    }, [playQueue, recordQueryPlay, songs]);

    const playOneSong = useCallback(
        async (track: MusicItem) => {
            recordQueryPlay(track);
            await togglePlayback(track);
        },
        [recordQueryPlay, togglePlayback],
    );
    function closeSaveDialog() {
        setSaveOpen(false);
        setSaveName("");
    }

    function submitSave() {
        const name = saveName.trim();
        if (!name) return;
        console.info(
            `[QueryResults] Saving query "${name}" is not implemented yet.`,
        );
        closeSaveDialog();
    }

    return (
        <View className="flex-1">
            <TrackCollectionView
                title="Matching Songs"
                tracks={songs}
                isLoading={isLoading}
                error={error}
                anticipatedTrackCount={anticipatedTrackCount}
                respectTopSafeArea
                closeControl={
                    <FloatingCloseButton
                        label="Close query results"
                        size={HERO_BUTTON_SIZE}
                    />
                }
                multiSelect={{}}
                showTags
                mostRelevantTags={mostRelevantTags}
                activityTagIds={activityTagIds}
                backgroundColor={tint}
                artworkUrls={artworkUrls}
                onPlay={playFromTop}
                onTrackPressOverride={playOneSong}
                options={[
                    {
                        id: "save-query",
                        label: "Save query",
                        icon: "bookmark-outline",
                        onPress: () => setSaveOpen(true),
                    },
                ]}
            />

            <ModalPopup
                visible={saveOpen}
                onClose={closeSaveDialog}
                title="Save Query"
                contentStyle={{
                    width: saveDialogWidth,
                    minWidth: saveDialogWidth,
                    maxWidth: saveDialogWidth,
                    transform: [{ translateY: -96 }],
                }}
            >
                <Text className="text-sm text-muted-foreground">
                    Give this query a name.
                </Text>
                <View className="gap-1.5">
                    <Label>Query name</Label>
                    <Input
                        value={saveName}
                        onChangeText={setSaveName}
                        placeholder="e.g. Late night favorites"
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={submitSave}
                    />
                </View>
                <View className="mt-1 flex-row gap-2.5">
                    <View className="flex-1">
                        <GlassButton
                            className="w-full"
                            onPress={closeSaveDialog}
                        >
                            <Text>Cancel</Text>
                        </GlassButton>
                    </View>
                    <View className="flex-1">
                        <GlassButton
                            className="w-full"
                            disabled={!saveName.trim()}
                            onPress={submitSave}
                        >
                            <Text>Save</Text>
                        </GlassButton>
                    </View>
                </View>
            </ModalPopup>
        </View>
    );
}
