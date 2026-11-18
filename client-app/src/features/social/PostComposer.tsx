import Ionicons from "@expo/vector-icons/Ionicons";
import type { ArtistItem, MusicItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type Ref,
} from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";

import { ArtworkMosaic } from "@/components/custom/artwork-mosaic";
import { SearchField } from "@/components/custom/search-field";
import { Button } from "@/components/ui/button";
import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { Text } from "@/components/ui/text";
import { withAlpha } from "@/lib/artwork-color";
import { useAppleMusic } from "@/lib/apple-music-auth";
import {
    useCatalogArtistSearch,
    useCatalogSongSearch,
    useSongInfo,
} from "@/lib/musickit-hooks";
import {
    useSharedPlaylists,
    type SharedPlaylistSummary,
} from "@/lib/routes/shared-playlists";
import { useAppTheme } from "@/lib/theme";
import type { PostTopic } from "@/lib/types";
import { cn, isUsableArtworkUrl } from "@/lib/utils";

import { PostTopicCard } from "./PostTopicCard";
import { topicFromArtist, topicFromSong } from "./topic";
import { rankTopicSearch } from "./topic-search";

const MAX_POST_LENGTH = 500;
const SEARCH_DEBOUNCE_MS = 350;
const MIN_SEARCH_LENGTH = 2;
const SONG_RESULT_LIMIT = 6;
const ARTIST_RESULT_LIMIT = 4;

export type PostComposerOptions = {
    /** Searches only run while the composer is showing. */
    active: boolean;
    /**
     * Called with the trimmed body and the attached topic or shared playlist,
     * if there is one. Resolve once the post exists. Reject to keep what was
     * written.
     */
    onCreate: (
        content: string,
        topic?: PostTopic | null,
        playlist?: SharedPlaylistSummary | null,
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
    const [playlist, setPlaylist] = useState<SharedPlaylistSummary | null>(
        null,
    );
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
    const { sharedPlaylists, sharedPlaylistsLoading } = useSharedPlaylists(
        active && !topicLocked,
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
        setPlaylist(null);
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
            await onCreate(
                trimmed,
                topicLocked ? lockedTopic : topic,
                topicLocked ? null : playlist,
            );
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
        setPlaylist(null);
        setTopic(next);
        clearSearch();
    }

    function selectPlaylist(next: SharedPlaylistSummary) {
        if (postingRef.current) return;
        setTopic(null);
        setPlaylist(next);
        clearSearch();
    }

    const trimmedLength = content.trim().length;
    const songs = catalogSongs.searchResults.slice(0, SONG_RESULT_LIMIT);
    const artists = catalogArtists.artists.slice(0, ARTIST_RESULT_LIMIT);
    const results = useMemo(
        () =>
            submittedTerm
                ? rankTopicSearch(
                      submittedTerm,
                      songs,
                      artists,
                      sharedPlaylists ?? [],
                  )
                : [],
        [artists, sharedPlaylists, songs, submittedTerm],
    );
    const playlistsLoading = sharedPlaylistsLoading && !sharedPlaylists;
    const searching =
        catalogSongs.searchCatalogLoading ||
        catalogArtists.artistsLoading ||
        playlistsLoading;
    const showResults =
        !selectedTopic &&
        !playlist &&
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
        selectedPlaylist: playlist,
        lockedAttachment,
        removeTopic: () => setTopic(null),
        removePlaylist: () => setPlaylist(null),
        selectSong: (song: MusicItem) => selectTopic(topicFromSong(song)),
        selectArtist: (artist: ArtistItem) =>
            selectTopic(topicFromArtist(artist)),
        selectPlaylist,
        results,
        searching,
        showResults,
        noResults: showResults && !searching && results.length === 0,
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
    highContrast = false,
}: {
    composer: PostComposer;
    autoFocus?: boolean;
    minHeight?: number;
    /** The body field, for a caller that focuses it itself. */
    inputRef?: Ref<TextInput>;
    /** Uses popup-specific colors for text and supporting chrome. */
    highContrast?: boolean;
}) {
    const { foreground, mutedForeground } = useAppTheme().colors;
    const { colors } = useTheme();
    // Match the feed's dividers so popup controls stay present without
    // competing with the form's content.
    const detailColor = highContrast
        ? withAlpha(mutedForeground, 0.55)
        : mutedForeground;
    const {
        content,
        setContent,
        posting,
        selectedTopic,
        selectedPlaylist,
        lockedAttachment,
        topicLocked,
        topicQuery,
        setTopicQuery,
        clearSearch,
        showResults,
        searching,
        noResults,
        results,
    } = composer;
    const coverIds = useMemo(
        () =>
            results.flatMap((result) =>
                result.kind === "playlist"
                    ? result.playlist.cover_song_ids.slice(0, 1)
                    : [],
            ),
        [results],
    );
    const { songInfo } = useSongInfo(coverIds);
    const artworkById = useMemo(() => {
        const map = new Map<string, string>();
        for (const song of songInfo) {
            if (!isUsableArtworkUrl(song.artworkUrl)) continue;
            map.set(song.id, song.artworkUrl!);
            if (song.catalogId) map.set(song.catalogId, song.artworkUrl!);
        }
        return map;
    }, [songInfo]);

    return (
        <View className="gap-3">
            <View
                className="overflow-hidden rounded-2xl border"
                style={{ borderColor: detailColor }}
            >
                <TextInput
                    ref={inputRef}
                    value={content}
                    onChangeText={setContent}
                    placeholder="What's on your mind?"
                    placeholderTextColor={detailColor}
                    multiline
                    autoFocus={autoFocus}
                    editable={!posting}
                    maxLength={MAX_POST_LENGTH}
                    textAlignVertical="top"
                    className="px-3 py-3 text-base text-foreground"
                    style={{ minHeight }}
                />
            </View>

            <Text className="text-right text-xs" style={{ color: detailColor }}>
                {content.length}/{MAX_POST_LENGTH}
            </Text>

            <View className="gap-1.5">
                <Text
                    className="text-sm font-semibold leading-none"
                    style={{ color: foreground }}
                >
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
                ) : selectedPlaylist ? (
                    <SelectedPlaylist
                        playlist={selectedPlaylist}
                        onRemove={posting ? undefined : composer.removePlaylist}
                    />
                ) : (
                    <SearchField
                        value={topicQuery}
                        onChangeText={setTopicQuery}
                        placeholder="Search songs, artists, etc."
                        onClear={clearSearch}
                        surface="outline"
                        editable={!posting}
                        accessibilityLabel="Search for a topic"
                    />
                )}
            </View>

            {showResults ? (
                <View
                    className="overflow-hidden rounded-2xl border"
                    style={{ borderColor: detailColor }}
                >
                    {searching && results.length === 0 ? (
                        <View className="items-center py-4">
                            <ActivityIndicator
                                color={highContrast ? detailColor : colors.text}
                            />
                        </View>
                    ) : noResults ? (
                        <Text
                            className="px-3 py-3 text-sm"
                            style={{ color: detailColor }}
                        >
                            No matching songs or artists.
                        </Text>
                    ) : (
                        results.map((result) =>
                            result.kind === "playlist" ? (
                                <TopicSearchRow
                                    key={`playlist-${result.playlist.playlist_id}`}
                                    title={result.playlist.name}
                                    subtitle="Shared playlist"
                                    artworkUrl={result.playlist.cover_song_ids
                                        .map((id) => artworkById.get(id))
                                        .find((url) => url != null)}
                                    icon="list"
                                    highContrast={highContrast}
                                    onPress={() =>
                                        composer.selectPlaylist(result.playlist)
                                    }
                                />
                            ) : result.kind === "artist" ? (
                                <TopicSearchRow
                                    key={`artist-${result.artist.id}`}
                                    title={result.artist.name}
                                    subtitle="Artist"
                                    artworkUrl={result.artist.artworkUrl}
                                    round
                                    highContrast={highContrast}
                                    onPress={() =>
                                        composer.selectArtist(result.artist)
                                    }
                                />
                            ) : (
                                <TopicSearchRow
                                    key={`song-${result.song.id}`}
                                    title={result.song.title}
                                    subtitle={result.song.artistName}
                                    artworkUrl={result.song.artworkUrl}
                                    highContrast={highContrast}
                                    onPress={() =>
                                        composer.selectSong(result.song)
                                    }
                                />
                            ),
                        )
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
    highContrast = false,
}: {
    composer: PostComposer;
    submitLabel?: string;
    onCancel?: () => void;
    highContrast?: boolean;
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
                style={{ color }}
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
                        className="h-11 flex-1 items-center justify-center rounded-full bg-muted active:opacity-70"
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

function SelectedPlaylist({
    playlist,
    onRemove,
}: {
    playlist: SharedPlaylistSummary;
    onRemove?: () => void;
}) {
    const { colors } = useAppTheme();
    const { songInfo } = useSongInfo(playlist.cover_song_ids);
    const artworkUrls = playlist.cover_song_ids.flatMap((id) => {
        const song = songInfo.find(
            (info) => info.id === id || info.catalogId === id,
        );
        return isUsableArtworkUrl(song?.artworkUrl) ? [song!.artworkUrl!] : [];
    });
    return (
        <View className="flex-row items-center overflow-hidden rounded-lg bg-muted">
            <ArtworkMosaic
                artworkUrls={artworkUrls}
                size={64}
                placeholderColor={colors.muted}
                className="rounded-none"
            />
            <View className="min-w-0 flex-1 justify-center px-3">
                <Text
                    className="text-base font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {playlist.name}
                </Text>
                <Text
                    className="text-xs text-muted-foreground"
                    numberOfLines={1}
                >
                    Shared playlist
                </Text>
            </View>
            {onRemove ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove attached playlist"
                    onPress={onRemove}
                    hitSlop={10}
                    className="mr-2 h-8 w-8 items-center justify-center rounded-full active:opacity-60"
                >
                    <Ionicons
                        name="close"
                        size={16}
                        color={colors.mutedForeground}
                    />
                </Pressable>
            ) : null}
        </View>
    );
}

function TopicSearchRow({
    title,
    subtitle,
    artworkUrl,
    round = false,
    icon,
    highContrast = false,
    onPress,
}: {
    title: string;
    subtitle?: string;
    artworkUrl?: string;
    round?: boolean;
    icon?: "person" | "musical-notes" | "list";
    highContrast?: boolean;
    onPress: () => void;
}) {
    const { foreground, mutedForeground } = useAppTheme().colors;
    const textColor = highContrast ? foreground : mutedForeground;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Attach ${title}`}
            onPress={onPress}
            className="flex-row items-center gap-3 px-3 py-2 active:opacity-60"
        >
            <RemoteArtwork
                url={artworkUrl}
                className={cn(
                    "shrink-0",
                    round ? "rounded-full" : "rounded-md",
                )}
                style={{ width: 36, height: 36 }}
                fallback={
                    <Ionicons
                        name={icon ?? (round ? "person" : "musical-notes")}
                        size={16}
                        color={textColor}
                    />
                }
            />
            <View className="min-w-0 flex-1">
                <Text
                    className="text-sm font-medium"
                    style={{ color: textColor }}
                    numberOfLines={1}
                >
                    {title}
                </Text>
                {subtitle ? (
                    <Text
                        className="text-xs"
                        style={{ color: textColor }}
                        numberOfLines={1}
                    >
                        {subtitle}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
}
