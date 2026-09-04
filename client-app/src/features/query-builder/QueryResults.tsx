import { MusicList } from "@/components/custom/music-list";
import { Button } from "@/components/ui/button";
import { MusicItem } from "@apple-musickit";
import { View, Text, StyleSheet } from "react-native";

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
