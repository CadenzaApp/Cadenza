import { MusicList } from "@/components/custom/music-list";
import { SongDetailModal } from "@/components/custom/song-detail-modal";
import { Button } from "@/components/ui/button";
import { useAppleMusic } from "@/lib/apple-music";
import { usePlayback } from "@/lib/playback";
import { Tag } from "@/lib/types";
import { MusicItem } from "@apple-musickit";
import { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";

type Props = {
    songs: MusicItem[];
    onBackPress: () => any;
};
export default function QueryResults({ songs, onBackPress }: Props) {
    const [selectedSong, setSelectedSong] = useState<MusicItem | null>(null);
    const [isSongDetailModalOpen, setIsSongDetailModalOpen] = useState(false);
    const { isConnected, ensureConnected } = useAppleMusic();
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();

    async function handleTogglePlayback(trackId: string) {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before playing songs.",
            );
            return;
        }

        try {
            await ensureConnected();
            await togglePlayback(trackId);
        } catch (e) {
            console.error(e);
        }
    }

    function handleTrackSelected(track: MusicItem, _: Tag[]) {
        setSelectedSong(track);
        setIsSongDetailModalOpen(true);
    }

    return (
        <View style={styles.container}>
            <Text style={styles.headerText} className="text-foreground">
                Your Mix
            </Text>
            <View style={styles.container}>
                <MusicList
                    tracks={songs}
                    isLoading={false}
                    activeTrackId={activeTrackId}
                    isPlaying={isPlaying}
                    onTogglePlayback={handleTogglePlayback}
                    onSelectTrack={handleTrackSelected}
                />
                <SongDetailModal
                    open={isSongDetailModalOpen}
                    onOpenChange={setIsSongDetailModalOpen}
                    song={selectedSong}
                    tags={[]}
                    onTogglePlayback={togglePlayback}
                    isThisTrackPlaying={Boolean(
                        selectedSong?.id &&
                        activeTrackId === selectedSong.id &&
                        isPlaying,
                    )}
                />
            </View>
            <Button onPress={onBackPress}>
                <Text> Back </Text>
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
        gap: 12,
    },
    headerText: {
        fontWeight: "600",
        fontSize: 13,
        letterSpacing: 0.5,
    },
});
