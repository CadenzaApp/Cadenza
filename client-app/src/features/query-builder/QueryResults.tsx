import { MusicList } from "@/components/custom/music-list";
import { SongDetailModal } from "@/components/custom/song-detail-modal";
import { Button } from "@/components/ui/button";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { usePlayback } from "@/lib/playback";
import { MusicItem } from "@apple-musickit";
import { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";

type Props = {
    songs: MusicItem[];
    isLoading: boolean;
    error?: unknown;
    anticipatedTrackCount?: number;
    onBackPress: () => any;
};

export default function QueryResults({
    songs,
    isLoading,
    error,
    anticipatedTrackCount,
    onBackPress,
}: Props) {
    const [selectedSong, setSelectedSong] = useState<MusicItem | null>(null);
    const { isConnected, ensureConnected } = useAppleMusic();
    const { activeTrackId, isPlaying, togglePlayback } = usePlayback();

    async function handleTogglePlayback(track: MusicItem) {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before playing songs.",
            );
            return;
        }

        try {
            await ensureConnected();
            await togglePlayback(track);
        } catch (e) {
            console.error(e);
        }
    }

    return (
        <View style={styles.container}>
            <Text style={styles.headerText} className="text-foreground">
                Your Mix
            </Text>
            <View style={styles.container}>
                {error ? (
                    <Text className="text-destructive text-center">
                        Failed to load song metadata.
                    </Text>
                ) : null}
                <MusicList
                    tracks={songs}
                    isLoading={isLoading}
                    anticipatedTrackCount={anticipatedTrackCount}
                    activeTrackId={activeTrackId}
                    isPlaying={isPlaying}
                    onTogglePlayback={handleTogglePlayback}
                    onSelectTrack={setSelectedSong}
                />

                <SongDetailModal
                    open={selectedSong != null}
                    onClose={() => setSelectedSong(null)}
                    song={selectedSong}
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
