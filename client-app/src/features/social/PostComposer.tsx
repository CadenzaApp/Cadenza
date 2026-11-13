import Ionicons from "@expo/vector-icons/Ionicons";
import type { ArtistItem, MusicItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    TextInput,
    View,
} from "react-native";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppleMusic } from "@/lib/apple-music-auth";
import {
    useCatalogArtistSearch,
    useCatalogSongSearch,
} from "@/lib/musickit-hooks";
import { useAppTheme } from "@/lib/theme";
import type { PostTopic } from "@/lib/types";
import { cn, isUsableArtworkUrl } from "@/lib/utils";

import { PostTopicCard } from "./PostTopicCard";
import { topicFromArtist, topicFromSong } from "./topic";

const MAX_POST_LENGTH = 500;
const SEARCH_DEBOUNCE_MS = 350;
const MIN_SEARCH_LENGTH = 2;
const SONG_RESULT_LIMIT = 6;
const ARTIST_RESULT_LIMIT = 4;

export type PostComposerOptions = {
    /** Searches only run while the composer is showing. */
    active: boolean;
    /**
     * Called with the trimmed body and the attached topic, if there is one.
     * Resolve once the post exists. Reject to keep what was written.
     */
    onCreate: (
        content: string,
        topic?: PostTopic | null,
    ) => void | Promise<void>;
    /** Called once the post exists, after the form clears. */
    onPosted?: () => void;
    /**
     * Topic the user cannot change. Hides the search and the remove control.
     * `onCreate` receives this topic.
     */
    lockedTopic?: PostTopic | null;
    /**
     * Something attached that is not a song or artist, like a shared
     * playlist's card. Shown in place of the topic and its search; the caller
     * sends it with the post, and `onCreate` gets no topic.
     */
    lockedAttachment?: ReactNode;
};

/**
 * A new post's state: the body, the topic and its catalog search, and
 * posting. Shared by the post dialog and the feed's inline composer, which
 * each draw it with `PostComposerFields` and `PostComposerSubmit`.
 */
export function usePostComposer({
    active,
    onCreate,
    onPosted,
    lockedTopic,
    lockedAttachment,
}: PostComposerOptions) {
    // attaching a song or artist searches the catalog, which works without
    // Apple Music connected
    const { canReadCatalog } = useAppleMusic();
    const [content, setContent] = useState("");
    const [topic, setTopic] = useState<PostTopic | null>(null);
    const [topicQuery, setTopicQuery] = useState("");
    const [submittedTerm, setSubmittedTerm] = useState<string | undefined>();
    const [posting, setPosting] = useState(false);
    const [postError, setPostError] = useState<string | null>(null);
    const postingRef = useRef(false);

    const topicLocked = lockedTopic != null || lockedAttachment != null;
    const selectedTopic = topicLocked ? lockedTopic : topic;
    const catalogSongs = useCatalogSongSearch(
        active && canReadCatalog && !topicLocked,
    );
    const catalogArtists = useCatalogArtistSearch(
        submittedTerm,
        active && canReadCatalog && Boolean(submittedTerm) && !topicLocked,
    );

    useEffect(() => {
        if (!active || topicLocked) return;
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
    }, [active, topicLocked, topicQuery]);

    function clearSearch() {
        setTopicQuery("");
        setSubmittedTerm(undefined);
        catalogSongs.clearSearchCatalog();
    }

    function reset() {
        setContent("");
        setTopic(null);
        setPostError(null);
        clearSearch();
    }

    function setPostingState(value: boolean) {
        postingRef.current = value;
        setPosting(value);
    }

    async function post() {
        const trimmed = content.trim();
        if (
            !trimmed ||
            trimmed.length > MAX_POST_LENGTH ||
            postingRef.current
        ) {
            return;
        }
        setPostError(null);
        setPostingState(true);
        try {
            await onCreate(trimmed, topicLocked ? lockedTopic : topic);
            setPostingState(false);
            reset();
            onPosted?.();
        } catch {
            setPostingState(false);
            setPostError("Couldn't publish your post.");
        }
    }

    function selectTopic(next: PostTopic) {
        if (postingRef.current) return;
        setTopic(next);
        clearSearch();
    }

    const trimmedLength = content.trim().length;
    const songs = catalogSongs.searchResults.slice(0, SONG_RESULT_LIMIT);
    const artists = catalogArtists.artists.slice(0, ARTIST_RESULT_LIMIT);
    const searching =
        catalogSongs.searchCatalogLoading || catalogArtists.artistsLoading;
    const showResults =
        !selectedTopic &&
        Boolean(submittedTerm) &&
        topicQuery.trim().length >= MIN_SEARCH_LENGTH;

    return {
        content,
        setContent: (text: string) =>
            setContent(text.slice(0, MAX_POST_LENGTH)),
        topicQuery,
        setTopicQuery,
        clearSearch,
        topicLocked,
        selectedTopic,
        lockedAttachment,
        removeTopic: () => setTopic(null),
        selectSong: (song: MusicItem) => selectTopic(topicFromSong(song)),
        selectArtist: (artist: ArtistItem) =>
            selectTopic(topicFromArtist(artist)),
        songs,
        artists,
        searching,
        showResults,
        noResults:
            showResults &&
            !searching &&
            songs.length === 0 &&
            artists.length === 0,
        posting,
        /** Closing is refused while a post is on its way. */
        isPosting: () => postingRef.current,
        postError,
        canPost: trimmedLength > 0 && trimmedLength <= MAX_POST_LENGTH,
        post,
        reset,
    };
}

export type PostComposer = ReturnType<typeof usePostComposer>;

/** The body field, its count, the topic, and the topic's search results. */
export function PostComposerFields({
    composer,
    autoFocus = true,
    minHeight = 120,
    inputRef,
}: {
    composer: PostComposer;
    autoFocus?: boolean;
    minHeight?: number;
    /** The body field, for a caller that focuses it itself. */
    inputRef?: Ref<TextInput>;
}) {
    const { mutedForeground } = useAppTheme().colors;
    const { colors } = useTheme();
    const {
        content,
        setContent,
        posting,
        selectedTopic,
        lockedAttachment,
        topicLocked,
        topicQuery,
        setTopicQuery,
        clearSearch,
        showResults,
        searching,
        noResults,
        songs,
        artists,
    } = composer;

    return (
        <View className="gap-3">
            <View className="overflow-hidden rounded-2xl border border-border">
                <TextInput
                    ref={inputRef}
                    value={content}
                    onChangeText={setContent}
                    placeholder="What's on your mind?"
                    placeholderTextColor={mutedForeground}
                    multiline
                    autoFocus={autoFocus}
                    editable={!posting}
                    maxLength={MAX_POST_LENGTH}
                    textAlignVertical="top"
                    className="px-3 py-3 text-base text-foreground"
                    style={{ minHeight }}
                />
            </View>

            <Text className="text-right text-xs text-muted-foreground">
                {content.length}/{MAX_POST_LENGTH}
            </Text>

            <View className="gap-1.5">
                <Text className="text-sm font-semibold leading-none">
                    Topic
                </Text>
                {lockedAttachment ? (
                    lockedAttachment
                ) : selectedTopic ? (
                    <PostTopicCard
                        topic={selectedTopic}
                        onRemove={
                            topicLocked || posting
                                ? undefined
                                : composer.removeTopic
                        }
                    />
                ) : (
                    <View className="overflow-hidden rounded-2xl border border-border">
                        <View className="flex-row items-center gap-2 px-3">
                            <Ionicons
                                name="search"
                                size={16}
                                color={mutedForeground}
                            />
                            <TextInput
                                value={topicQuery}
                                onChangeText={setTopicQuery}
                                placeholder="Search songs and artists"
                                placeholderTextColor={mutedForeground}
                                returnKeyType="search"
                                autoCorrect={false}
                                autoCapitalize="none"
                                editable={!posting}
                                // a font size alone, no line height, and no
                                // vertical padding, so iOS centers the text
                                className="h-11 flex-1 text-foreground"
                                style={{ fontSize: 16, paddingVertical: 0 }}
                            />
                            {topicQuery.length > 0 ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Clear topic search"
                                    onPress={clearSearch}
                                    hitSlop={8}
                                    className="active:opacity-60"
                                >
                                    <Ionicons
                                        name="close-circle"
                                        size={16}
                                        color={mutedForeground}
                                    />
                                </Pressable>
                            ) : null}
                        </View>
                    </View>
                )}
            </View>

            {showResults ? (
                <View className="overflow-hidden rounded-2xl border border-border">
                    {searching && songs.length === 0 && artists.length === 0 ? (
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
                                    onPress={() =>
                                        composer.selectArtist(artist)
                                    }
                                />
                            ))}
                            {songs.map((song) => (
                                <TopicSearchRow
                                    key={`song-${song.id}`}
                                    title={song.title}
                                    subtitle={song.artistName}
                                    artworkUrl={song.artworkUrl}
                                    onPress={() => composer.selectSong(song)}
                                />
                            ))}
                        </>
                    )}
                </View>
            ) : null}
        </View>
    );
}

/**
 * The post error, if any, and the submit button, which spins while posting.
 * With `onCancel` they are a pair of pills, Cancel and a brand colored Post,
 * for the feed's inline composer.
 */
export function PostComposerSubmit({
    composer,
    submitLabel = "Post",
    onCancel,
}: {
    composer: PostComposer;
    submitLabel?: string;
    onCancel?: () => void;
}) {
    const { primaryForeground, brandForeground } = useAppTheme().colors;
    const { posting, canPost, postError } = composer;
    const disabled = !canPost || posting;
    const label = (color: string) =>
        posting ? (
            <ActivityIndicator color={color} size="small" />
        ) : (
            <Text
                className={
                    onCancel
                        ? "text-base font-semibold text-brand-foreground"
                        : undefined
                }
            >
                {submitLabel}
            </Text>
        );

    return (
        <View className="gap-2">
            {postError ? (
                <Text
                    accessibilityRole="alert"
                    className="text-center text-sm text-destructive"
                >
                    {postError}
                </Text>
            ) : null}
            {onCancel ? (
                <View className="flex-row gap-3">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                        disabled={posting}
                        onPress={onCancel}
                        className="h-11 flex-1 items-center justify-center rounded-full border border-border bg-muted active:opacity-70"
                    >
                        <Text className="text-base font-semibold text-foreground">
                            Cancel
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={posting ? "Posting" : submitLabel}
                        accessibilityState={{ disabled, busy: posting }}
                        disabled={disabled}
                        onPress={() => void composer.post()}
                        className={cn(
                            "h-11 flex-1 items-center justify-center rounded-full bg-brand active:opacity-70",
                            disabled && !posting && "opacity-50",
                        )}
                    >
                        {label(brandForeground)}
                    </Pressable>
                </View>
            ) : (
                <Button
                    accessibilityLabel={posting ? "Posting" : submitLabel}
                    accessibilityState={{ disabled, busy: posting }}
                    disabled={disabled}
                    onPress={() => void composer.post()}
                >
                    {label(primaryForeground)}
                </Button>
            )}
        </View>
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
    const { mutedForeground } = useAppTheme().colors;
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
                        color={mutedForeground}
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
