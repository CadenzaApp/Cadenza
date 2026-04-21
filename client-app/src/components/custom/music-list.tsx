import { FlatList } from "react-native";
import { MusicItem as AppleMusicItem } from "@apple-musickit";
import { Text } from "@/components/ui/text";
import { Tag } from "@/types/tag-types";
import { MusicListItem } from "./music-list-item";

type MusicListProps = {
    tracks: AppleMusicItem[];
    isLoading: boolean;
    activeTrackId: string | null;
    isPlaying: boolean;
    onTogglePlayback: (trackId: string) => void;
    onSelectTrack?: (track: AppleMusicItem, tags: Tag[]) => void;
};

export function MusicList({
    tracks,
    isLoading,
    activeTrackId,
    isPlaying,
    onTogglePlayback,
    onSelectTrack,
}: MusicListProps) {
    return (
        <FlatList
            data={tracks}
            keyExtractor={(item, index) => item.id || index.toString()}
            renderItem={({ item }) => (
                <MusicListItem
                    item={item}
                    isThisTrackPlaying={activeTrackId === item.id && isPlaying}
                    onTogglePlayback={onTogglePlayback}
                    onPress={onSelectTrack}
                />
            )}
            contentContainerClassName="px-6 pb-10"
            ListEmptyComponent={
                !isLoading && tracks.length === 0 ? (
                    <Text className="text-muted-foreground text-center mt-10">
                        No tracks loaded yet.
                    </Text>
                ) : null
            }
        />
    );
}
