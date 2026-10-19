import Ionicons from "@expo/vector-icons/Ionicons";
import type { ArtistItem, MusicItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModalPopup } from "@/components/custom/modal-popup";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppleMusic } from "@/lib/apple-music-auth";
import {
    useCatalogArtistSearch,
    useCatalogSongSearch,
} from "@/lib/musickit-hooks";
import type { PostTopic } from "@/lib/types";
import { cn, isUsableArtworkUrl } from "@/lib/utils";

import { PostTopicCard } from "./PostTopicCard";
import { topicFromArtist, topicFromSong } from "./topic";

const MAX_DIALOG_WIDTH = 400;
const SCREEN_MARGIN = 20;
const DIALOG_PADDING = 24;
const MAX_POST_LENGTH = 500;
const SEARCH_DEBOUNCE_MS = 350;
const MIN_SEARCH_LENGTH = 2;
const SONG_RESULT_LIMIT = 6;
const ARTIST_RESULT_LIMIT = 4;

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called with the trimmed body and the attached topic, if there is one. */
    onCreate: (
        content: string,
        topic?: PostTopic | null,
    ) => void | Promise<void>;
    /** Dialog heading. */
    title?: string;
    /** Submit button label. */
    submitLabel?: string;
    /**
     * Topic the user cannot change. Hides the search and the remove control.
     * `onCreate` receives this topic.
     */
    lockedTopic?: PostTopic | null;
};

/** Compose dialog for a new post. Closes as soon as the user submits. */
export function CreatePostDialog({
    open,
    onOpenChange,
    onCreate,
    title = "New post",
    submitLabel = "Post",
    lockedTopic,
}: Props) {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const dialogWidth = Math.min(
        screenWidth - SCREEN_MARGIN * 2,
        MAX_DIALOG_WIDTH,
    );
    const { isConnected } = useAppleMusic();
    const [content, setContent] = useState("");
    const [topic, setTopic] = useState<PostTopic | null>(null);
    const [topicQuery, setTopicQuery] = useState("");
    const [submittedTerm, setSubmittedTerm] = useState<string | undefined>();

    const topicLocked = lockedTopic != null;
    const selectedTopic = topicLocked ? lockedTopic : topic;
    const catalogSongs = useCatalogSongSearch(
        open && isConnected && !topicLocked,
    );
    const catalogArtists = useCatalogArtistSearch(
        submittedTerm,
        open && isConnected && Boolean(submittedTerm) && !topicLocked,
    );

    useEffect(() => {
        if (!open || topicLocked) return;
        const trimmed = topicQuery.trim();
        const delay =
            trimmed.length < MIN_SEARCH_LENGTH ? 0 : SEARCH_DEBOUNCE_MS;
        const timer = setTimeout(() => {
            if (trimmed.length < MIN_SEARCH_LENGTH) {
                setSubmittedTerm(undefined);
                catalogSongs.clearSearchCatalog();
                return;
            }
            setSubmittedTerm(trimmed);
            catalogSongs.searchCatalog(trimmed);
        }, delay);
        return () => clearTimeout(timer);
        // searchCatalog is recreated each render; the term is the real input.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, topicLocked, topicQuery]);

    function resetForm() {
        setContent("");
        setTopic(null);
        setTopicQuery("");
        setSubmittedTerm(undefined);
        catalogSongs.clearSearchCatalog();
    }

    function setOpen(val: boolean) {
        if (!val) resetForm();
        onOpenChange(val);
    }

    function handlePost() {
        const trimmed = content.trim();
        if (!trimmed || trimmed.length > MAX_POST_LENGTH) return;
        void onCreate(trimmed, topicLocked ? lockedTopic : topic);
        setOpen(false);
    }

    function selectSong(song: MusicItem) {
        setTopic(topicFromSong(song));
        setTopicQuery("");
        setSubmittedTerm(undefined);
        catalogSongs.clearSearchCatalog();
    }

    function selectArtist(artist: ArtistItem) {
        setTopic(topicFromArtist(artist));
        setTopicQuery("");
        setSubmittedTerm(undefined);
        catalogSongs.clearSearchCatalog();
    }

    const trimmedLength = content.trim().length;
    const canPost = trimmedLength > 0 && trimmedLength <= MAX_POST_LENGTH;
    const songs = catalogSongs.searchResults.slice(0, SONG_RESULT_LIMIT);
    const artists = catalogArtists.artists.slice(0, ARTIST_RESULT_LIMIT);
    const searching =
        catalogSongs.searchCatalogLoading || catalogArtists.artistsLoading;
    const showResults =
        !selectedTopic &&
        Boolean(submittedTerm) &&
        topicQuery.trim().length >= MIN_SEARCH_LENGTH;
    const noResults =
        showResults && !searching && songs.length === 0 && artists.length === 0;
    const maxDialogHeight = screenHeight - insets.top - insets.bottom - 24;

    return (
        <ModalPopup
            visible={open}
            onClose={() => setOpen(false)}
            backdropClassName="justify-start py-0"
            contentStyle={{
                width: dialogWidth,
                maxWidth: dialogWidth,
                maxHeight: maxDialogHeight,
                padding: DIALOG_PADDING,
                marginTop: insets.top + 12,
            }}
        >
            <Pressable
                onPress={() => setOpen(false)}
                hitSlop={12}
                className="absolute right-4 top-4 z-10 rounded opacity-70 active:opacity-100"
                accessibilityRole="button"
                accessibilityLabel={
                    title === "New post"
                        ? "Close create post dialog"
                        : `Close ${title.toLowerCase()} dialog`
                }
            >
                <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>

            <View className="mb-4 pr-6">
                <Text className="text-lg font-semibold leading-none">
                    {title}
                </Text>
            </View>

            <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: maxDialogHeight - 80 }}
            >
                <View className="gap-3">
                    <View className="overflow-hidden rounded-2xl border border-border">
                        <TextInput
                            value={content}
                            onChangeText={(text) =>
                                setContent(text.slice(0, MAX_POST_LENGTH))
                            }
                            placeholder="What's on your mind?"
                            placeholderTextColor="#888888"
                            multiline
                            autoFocus
                            maxLength={MAX_POST_LENGTH}
                            textAlignVertical="top"
                            className="min-h-[120px] px-3 py-3 text-base text-foreground"
                        />
                    </View>

                    <Text className="text-right text-xs text-muted-foreground">
                        {content.length}/{MAX_POST_LENGTH}
                    </Text>

                    <View className="gap-1.5">
                        <Text className="text-sm font-semibold leading-none">
                            Topic
                        </Text>
                        {selectedTopic ? (
                            <PostTopicCard
                                topic={selectedTopic}
                                onRemove={
                                    topicLocked
                                        ? undefined
                                        : () => setTopic(null)
                                }
                            />
                        ) : (
                            <View className="overflow-hidden rounded-2xl border border-border">
                                <View className="flex-row items-center gap-2 px-3">
                                    <Ionicons
                                        name="search"
                                        size={16}
                                        color="#888888"
                                    />
                                    <TextInput
                                        value={topicQuery}
                                        onChangeText={setTopicQuery}
                                        placeholder="Search songs and artists"
                                        placeholderTextColor="#888888"
                                        returnKeyType="search"
                                        autoCorrect={false}
                                        autoCapitalize="none"
                                        className="flex-1 py-3 text-base text-foreground"
                                    />
                                    {topicQuery.length > 0 ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="Clear topic search"
                                            onPress={() => {
                                                setTopicQuery("");
                                                setSubmittedTerm(undefined);
                                                catalogSongs.clearSearchCatalog();
                                            }}
                                            hitSlop={8}
                                            className="active:opacity-60"
                                        >
                                            <Ionicons
                                                name="close-circle"
                                                size={16}
                                                color="#888888"
                                            />
                                        </Pressable>
                                    ) : null}
                                </View>
                            </View>
                        )}
                    </View>

                    {!selectedTopic && !isConnected ? (
                        <Text className="text-xs text-muted-foreground">
                            Connect Apple Music to attach a song or artist.
                        </Text>
                    ) : null}

                    {showResults ? (
                        <View className="overflow-hidden rounded-2xl border border-border">
                            {searching &&
                            songs.length === 0 &&
                            artists.length === 0 ? (
                                <View className="items-center py-4">
                                    <ActivityIndicator color={colors.text} />
                                </View>
                            ) : noResults ? (
                                <Text className="px-3 py-3 text-sm text-muted-foreground">
                                    No matching songs or artists.
                                </Text>
                            ) : (
                                <>
                                    {artists.map((artist) => (
                                        <TopicSearchRow
                                            key={`artist-${artist.id}`}
                                            title={artist.name}
                                            subtitle="Artist"
                                            artworkUrl={artist.artworkUrl}
                                            round
                                            onPress={() => selectArtist(artist)}
                                        />
                                    ))}
                                    {songs.map((song) => (
                                        <TopicSearchRow
                                            key={`song-${song.id}`}
                                            title={song.title}
                                            subtitle={song.artistName}
                                            artworkUrl={song.artworkUrl}
                                            onPress={() => selectSong(song)}
                                        />
                                    ))}
                                </>
                            )}
                        </View>
                    ) : null}
                </View>
            </ScrollView>

            <View className="mt-4">
                <Button
                    accessibilityLabel={submitLabel}
                    disabled={!canPost}
                    onPress={handlePost}
                >
                    <Text>{submitLabel}</Text>
                </Button>
            </View>
        </ModalPopup>
    );
}

function TopicSearchRow({
    title,
    subtitle,
    artworkUrl,
    round = false,
    onPress,
}: {
    title: string;
    subtitle?: string;
    artworkUrl?: string;
    round?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Attach ${title}`}
            onPress={onPress}
            className="flex-row items-center gap-3 px-3 py-2 active:opacity-60"
        >
            {isUsableArtworkUrl(artworkUrl) ? (
                <Image
                    source={{ uri: artworkUrl }}
                    className={cn(
                        "shrink-0 bg-muted",
                        round ? "rounded-full" : "rounded-md",
                    )}
                    style={{ width: 36, height: 36 }}
                />
            ) : (
                <View
                    className={cn(
                        "shrink-0 items-center justify-center bg-muted",
                        round ? "rounded-full" : "rounded-md",
                    )}
                    style={{ width: 36, height: 36 }}
                >
                    <Ionicons
                        name={round ? "person" : "musical-notes"}
                        size={16}
                        color="#a1a1a1"
                    />
                </View>
            )}
            <View className="min-w-0 flex-1">
                <Text
                    className="text-sm font-medium text-foreground"
                    numberOfLines={1}
                >
                    {title}
                </Text>
                {subtitle ? (
                    <Text
                        className="text-xs text-muted-foreground"
                        numberOfLines={1}
                    >
                        {subtitle}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
}
