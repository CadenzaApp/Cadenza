import { requireOptionalNativeModule } from "expo-modules-core";

import type {
    AuthResult,
    CatalogSearchType,
    LibraryResult,
    LibrarySongOptions,
    MusicItem,
    MusicKitOptions,
    PlaybackSnapshot,
    SearchResult,
    SongFavoriteStatus,
} from "./AppleMusicKit.types";
import { Auth, configureAuthNative } from "./auth";
import { MusicKit, configureLibraryNative } from "./library";
import { Playback, configurePlaybackNative } from "./playback";

export { Auth, MusicKit, Playback };
export type { PlaybackApi } from "./playback";
export * from "./AppleMusicKit.types";

interface AppleMusicKitNativeModule {
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
        options?: MusicKitOptions,
    ): Promise<SearchResult>;
    getUserPlaylists(options?: MusicKitOptions): Promise<LibraryResult>;
    getLibrarySongs(options?: LibrarySongOptions): Promise<LibraryResult>;
    getPlaylistSongs(
        playlistId: string,
        options?: MusicKitOptions,
    ): Promise<LibraryResult>;
    getSongFavoriteStatus(id: string): Promise<SongFavoriteStatus>;
    setSongFavoriteStatus(
        id: string,
        isFavorite: boolean,
    ): Promise<SongFavoriteStatus>;
    setPlaybackQueue(id: string, type: string): Promise<void>;
}

const native =
    requireOptionalNativeModule<AppleMusicKitNativeModule>("AppleMusicKit");

configureAuthNative(native);
configureLibraryNative(native);
configurePlaybackNative(native);
