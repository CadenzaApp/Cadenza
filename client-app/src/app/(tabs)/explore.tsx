import {useState} from "react";
import {View, ActivityIndicator, Alert} from "react-native";
import {MusicKit, MusicItem as AppleMusicItem} from "@apple-musickit";

import {Button} from "@/components/ui/button";
import {Text} from "@/components/ui/text";
import {MusicList} from "@/components/custom/music-list";
import {SongDetailModal} from "@/components/custom/song-detail-modal";
import {usePlayback} from "@/lib/playback";
import {useAppleMusic} from "@/lib/apple-music";
import {useAccount} from "@/lib/account";
import {fetchAllSongTags, applyTagToSong} from "@/lib/tags";
import {Tag} from "@/types/tag-types";

function getErrorDetails(error: unknown) {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            code: (error as any).code,
            nativeStackIOS: (error as any).nativeStackIOS,
            cause: (error as any).cause,
        };
    }

    if (typeof error === "object" && error !== null) {
        return error;
    }

    return {message: String(error)};
}

function getErrorMessage(error: unknown) {
    const details = getErrorDetails(error);

    if (
        typeof details === "object" &&
        details !== null &&
        "message" in details
    ) {
        return String(details.message);
    }

    return "Unknown error";
}

export default function ExploreScreen() {
    const [tracks, setTracks] = useState<AppleMusicItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedSong, setSelectedSong] = useState<AppleMusicItem | null>(null);
    const [selectedSongTags, setSelectedSongTags] = useState<Tag[]>([]);
    const [isSongDetailModalOpen, setIsSongDetailModalOpen] = useState(false);
    const [songTagsMap, setSongTagsMap] = useState<Record<string, Tag[]>>({});

    const {isInitializing, isConnected, ensureConnected} = useAppleMusic();
    const {activeTrackId, isPlaying, togglePlayback} = usePlayback();
    const {account} = useAccount();

    async function handleFetchLibrary() {
        if (!isConnected) {
            Alert.alert(
                "Apple Music Not Connected",
                "Connect Apple Music from the Account tab before loading your library.",
            );
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            await ensureConnected();
            const [result, tagsMap] = await Promise.all([
                MusicKit.getTracksFromLibrary(),
                account ? fetchAllSongTags(account.id) : Promise.resolve({}),
            ]);
            setTracks(result.items || []);
            setSongTagsMap(tagsMap);
        } catch (e) {
            console.error(
                "Failed to fetch library tracks:",
                getErrorDetails(e),
            );
            setError(`Failed to load library tracks. ${getErrorMessage(e)}`);
        } finally {
            setIsLoading(false);
        }
    }

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
            console.error("Failed to toggle playback:", getErrorDetails(e));
            Alert.alert(
                "Playback Error",
                `Failed to update playback state. ${getErrorMessage(e)}`,
            );
        }
    }

    function handleTrackSelected(track: AppleMusicItem, _tags: Tag[]) {
        setSelectedSong(track);
        setSelectedSongTags(track.id ? (songTagsMap[track.id] ?? []) : []);
        setIsSongDetailModalOpen(true);
    }

    async function handleApplyTag(tag: Tag) {
        if (!selectedSong?.id || !account) return;
        const songId = selectedSong.id;

        // Optimistic update — show the tag immediately in both the modal and the list
        setSelectedSongTags((prev) => [...prev, tag]);
        setSongTagsMap((prev) => ({
            ...prev,
            [songId]: [...(prev[songId] ?? []), tag],
        }));

        try {
            await applyTagToSong(songId, tag.id, account.id);
        } catch (e) {
            // Roll back if the DB call failed
            setSelectedSongTags((prev) => prev.filter((t) => t.id !== tag.id));
            setSongTagsMap((prev) => ({
                ...prev,
                [songId]: (prev[songId] ?? []).filter((t) => t.id !== tag.id),
            }));
            Alert.alert("Error", "Failed to add tag. Please try again.");
            console.error("Failed to apply tag:", e);
        }
    }

    return (
        <View className="flex-1 bg-background pt-16">
            <View className="px-6 mb-4">
                <Button
                    onPress={handleFetchLibrary}
                    disabled={isInitializing || isLoading || !isConnected}
                >
                    <Text>
                        {isLoading ? "Loading..." : "Load Library Songs"}
                    </Text>
                </Button>
            </View>

            {isLoading && (
                <View className="my-6 items-center">
                    <ActivityIndicator size="large" color="#888"/>
                </View>
            )}

            {error && (
                <Text className="text-destructive text-center my-2 px-6">
                    {error}
                </Text>
            )}

            <MusicList
                tracks={tracks}
                isLoading={isLoading}
                activeTrackId={activeTrackId}
                isPlaying={isPlaying}
                onTogglePlayback={handleTogglePlayback}
                onSelectTrack={handleTrackSelected}
                songTagsMap={songTagsMap}
            />

            <SongDetailModal
                open={isSongDetailModalOpen}
                onOpenChange={setIsSongDetailModalOpen}
                song={selectedSong}
                tags={selectedSongTags}
                onTogglePlayback={togglePlayback}
                isThisTrackPlaying={Boolean(
                    selectedSong?.id &&
                    activeTrackId === selectedSong.id &&
                    isPlaying,
                )}
                onApplyTag={handleApplyTag}
            />
        </View>
    );
}
