import { requireOptionalNativeModule } from "expo-modules-core";

import type {
    ArtistDetail,
    AuthResult,
    CatalogSearchType,
    LibraryResult,
    LibrarySongOptions,
    MusicItem,
    MusicKitOptions,
    PlaybackSnapshot,
    RepeatMode,
    SearchResult,
    ShuffleMode,
    SongFavoriteStatus,
} from "./AppleMusicKit.types";
import { Auth, configureAuthNative } from "./auth";
import { MusicKit, configureLibraryNative } from "./library";
import { Playback, configurePlaybackNative } from "./playback";
import { createMockNativeModule } from "./mock-native-module";

export { Auth, MusicKit, Playback };
export type { PlaybackApi } from "./playback";
export * from "./AppleMusicKit.types";

export interface AppleMusicKitNativeModule {
    authorize(developerToken: string): Promise<AuthResult>;
    setTokens(developerToken: string, userToken: string | null): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    togglePlayerState(): Promise<void>;
    getPlaybackSnapshot(): Promise<PlaybackSnapshot>;
    skipToNextEntry(): Promise<void>;
    skipToPreviousEntry(): Promise<void>;
    restartCurrentEntry(): Promise<void>;
    seekToTime(time: number): Promise<void>;
    getSongInfo(ids: string[]): Promise<MusicItem[]>;
    catalogSearch(
        query: string,
        types: CatalogSearchType[],
        limit: number,
        offset: number,
    ): Promise<SearchResult>;
    getUserPlaylists(options?: MusicKitOptions): Promise<LibraryResult>;
    getLibrarySongs(options?: LibrarySongOptions): Promise<LibraryResult>;
    getPlaylistSongs(
        playlistId: string,
        options?: MusicKitOptions,
    ): Promise<LibraryResult>;
    getLibraryAlbums(options?: MusicKitOptions): Promise<LibraryResult>;
    getRecentlyAdded(options?: MusicKitOptions): Promise<LibraryResult>;
    getAlbumSongs(
        albumId: string,
        options?: MusicKitOptions,
    ): Promise<LibraryResult>;
    getSongFavoriteStatus(id: string): Promise<SongFavoriteStatus>;
    setSongFavoriteStatus(
        id: string,
        isFavorite: boolean,
    ): Promise<SongFavoriteStatus>;
    setPlaybackQueue(id: string, type: string): Promise<void>;
    setSongPlaybackQueue(
        ids: readonly string[],
        types: readonly string[],
        startIndex: number,
    ): Promise<void>;
    appendSongPlaybackQueue(
        ids: readonly string[],
        types: readonly string[],
    ): Promise<void>;
    insertSongsNextInQueue(
        ids: readonly string[],
        types: readonly string[],
    ): Promise<void>;
    moveQueueItem(fromIndex: number, toIndex: number): Promise<void>;
    removeQueueItem(index: number): Promise<void>;
    playQueueItem(index: number): Promise<void>;
    setShuffleMode(mode: ShuffleMode): Promise<void>;
    setRepeatMode(mode: RepeatMode): Promise<void>;
    addSongsToPlaylist(
        playlistId: string,
        ids: readonly string[],
    ): Promise<void>;
    createPlaylist(name: string, ids: readonly string[]): Promise<MusicItem>;
    getSongArtists(songId: string): Promise<string[]>;
    getArtist(artistId: string): Promise<ArtistDetail>;
}

// Set EXPO_PUBLIC_MOCK_MUSICKIT=1 to answer from ./mock-native instead of the
// real module, for frontend work without a native build or a subscription.
const useMockData = process.env.EXPO_PUBLIC_MOCK_MUSICKIT === "1";

if (useMockData) {
    console.warn("AppleMusicKit: using mock data, no audio will play.");
}

const native: AppleMusicKitNativeModule | null = useMockData
    ? createMockNativeModule()
    : requireOptionalNativeModule<AppleMusicKitNativeModule>("AppleMusicKit");

configureAuthNative(native);
configureLibraryNative(native);
configurePlaybackNative(native);
