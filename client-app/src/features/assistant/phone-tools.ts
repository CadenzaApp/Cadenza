import {
    MusicKit,
    RepeatMode,
    ShuffleMode,
    type MusicItem,
} from "@apple-musickit";
import { useRouter, type Href } from "expo-router";
import { useCallback } from "react";
import { useSWRConfig } from "swr";

import { readAppleMusic } from "@/lib/apple-music-read";
import { useListeningEvents } from "@/lib/listening-events";
import { logHandledError } from "@/lib/log";
import { collectionRoute } from "@/lib/music-routes";
import { usePlaylistMutations, useTrackLookup } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import { usePlaybackCommands } from "@/lib/playback";

import { currentPlayback } from "./playback-snapshot";
import type { PendingConfirmation } from "./types";

/**
 * The tools only the phone can run, for the assistant. The backend sends one
 * as a `client_tool_call`; `useAssistantChat` runs it here and posts what it
 * returns back. Every tool resolves to JSON for the model and never throws:
 * a failure comes back as `{ error }` so the model can tell the user.
 *
 * A tool that returns songs puts them in `card` (`song_ids`, `total`,
 * `title`), which the backend turns into the card under the answer.
 *
 * Mirrors `backend-api/src/services/assistant/phone_tools.rs`, which defines
 * them for the model.
 */

/** The most songs a tool plays, queues, or puts on a card, like the backend's. */
const MAX_SONGS = 250;
/** The most songs a tool describes to the model. The card shows the rest. */
const MAX_DESCRIBED = 25;
/** The most Apple Music playlists listed. */
const MAX_PLAYLISTS = 200;
/** How many songs or playlists one Apple Music page asks for. */
const PAGE_SIZE = 100;

/** The tools that change the user's Apple Music library, which Cadenza cannot undo. */
const CONFIRMED_TOOLS = new Set([
    "create_apple_music_playlist",
    "add_to_apple_music_playlist",
]);

/** The settings sheets `open_screen` can open, by the name the model uses. */
const SHEETS: Record<string, Href> = {
    account: "/account",
    appearance: "/appearance",
    apple_music: "/apple-music",
    listening_preferences: "/listening-preferences",
    privacy: "/privacy",
    your_data: "/your-data",
};

/** The tabs `open_screen` can switch to, by the name the model uses. */
const TABS: Record<string, Href> = {
    social: "/social",
    analytics: "/analytics",
    cadenza: "/cadenza",
    library: "/library",
    search: "/search",
};

/** Names of the Apple Music playlists listed so far, by id, for card titles. */
const playlistNames = new Map<string, string>();

type ToolArgs = Record<string, unknown>;
type ToolOutput = Record<string, unknown>;

/** What the user is asked before a tool that needs their yes, or null for one that runs straight away. */
export function confirmationFor(
    name: string,
    args: ToolArgs,
): PendingConfirmation | null {
    if (!CONFIRMED_TOOLS.has(name)) return null;
    const count = songIdsOf(args).length;
    const songs = `${count.toLocaleString()} ${count === 1 ? "song" : "songs"}`;
    if (name === "create_apple_music_playlist") {
        return {
            title: "Make an Apple Music playlist?",
            detail: `"${stringOf(args.name) ?? "New Playlist"}" with ${songs}. Cadenza can't delete it afterwards.`,
            confirmLabel: "Make Playlist",
        };
    }
    return {
        title: "Add to an Apple Music playlist?",
        detail: `${songs} to the end of "${stringOf(args.playlist_name) ?? "your playlist"}". Cadenza can't remove them afterwards.`,
        confirmLabel: "Add Songs",
    };
}

/** Runs the assistant's phone tools. */
export function usePhoneTools() {
    const commands = usePlaybackCommands();
    const lookupTracks = useTrackLookup();
    const openScreen = useOpenScreen();
    const router = useRouter();
    const { recordEvent } = useListeningEvents();
    const { createPlaylist, addSongsToPlaylist } = usePlaylistMutations();
    const { mutate } = useSWRConfig();

    /** Tracks for `ids`, in order, leaving out any Apple Music cannot find. */
    const tracksFor = useCallback(
        async (ids: readonly string[]) => {
            const found = await lookupTracks(ids);
            return ids.flatMap((id) => {
                const track = found.get(id);
                return track ? [track] : [];
            });
        },
        [lookupTracks],
    );

    /** The songs a `songs` or `apple_music_playlist_id` argument names. */
    const songsOf = useCallback(
        async (args: ToolArgs) => {
            const playlistId = stringOf(args.apple_music_playlist_id);
            if (playlistId) return playlistTracks(playlistId);
            return tracksFor(songIdsOf(args));
        },
        [tracksFor],
    );

    return useCallback(
        async (name: string, args: ToolArgs): Promise<ToolOutput> => {
            const playback = currentPlayback();
            const locked = () =>
                playback?.controlsLocked
                    ? {
                          error: "Playback is locked: the user is in a live session they cannot control.",
                      }
                    : null;
            try {
                switch (name) {
                    case "now_playing": {
                        const track = playback?.activeTrack;
                        if (!playback || !track) return { playing: false };
                        return {
                            song: describe(track),
                            playing: playback.isPlaying,
                            position_seconds: Math.round(playback.progress),
                            duration_seconds: Math.round(playback.duration),
                            preview_only: playback.isPreview,
                            up_next: playback.upcoming
                                .slice(0, 10)
                                .map(describe),
                            up_next_count: playback.upcoming.length,
                            shuffle: playback.shuffleMode,
                            repeat: playback.repeatMode,
                            controls_locked: playback.controlsLocked,
                        };
                    }
                    case "play": {
                        const blocked = locked();
                        if (blocked) return blocked;
                        const tracks = (await songsOf(args)).slice(
                            0,
                            MAX_SONGS,
                        );
                        if (tracks.length === 0) {
                            return {
                                error: "Apple Music could not find any of those songs.",
                            };
                        }
                        const shuffled = args.shuffle === true;
                        await commands.setShuffleMode(ShuffleMode.Off);
                        await commands.playQueue({
                            tracks: shuffled ? shuffledCopy(tracks) : tracks,
                            startIndex: 0,
                        });
                        return {
                            playing: tracks.length,
                            shuffled,
                            first: shuffled ? undefined : tracks[0].title,
                        };
                    }
                    case "playback": {
                        const blocked = locked();
                        if (blocked) return blocked;
                        const track = playback?.activeTrack;
                        if (!playback || !track) {
                            return { error: "Nothing is playing." };
                        }
                        switch (args.action) {
                            case "pause":
                                if (playback.isPlaying) {
                                    await commands.togglePlayback(track);
                                }
                                return { paused: track.title };
                            case "resume":
                                if (!playback.isPlaying) {
                                    await commands.togglePlayback(track);
                                }
                                return { resumed: track.title };
                            case "next":
                                if (!playback.canSkipToNext) {
                                    return {
                                        error: "There is no next song in the queue.",
                                    };
                                }
                                await commands.skipToNext();
                                return { skipped: track.title };
                            case "previous":
                                if (!playback.canSkipToPrevious) {
                                    return {
                                        error: "There is no previous song.",
                                    };
                                }
                                await commands.skipToPrevious();
                                return { went_back_from: track.title };
                            case "restart":
                                await commands.seekTo(0);
                                return { restarted: track.title };
                            default:
                                return {
                                    error: "action must be pause, resume, next, previous, or restart.",
                                };
                        }
                    }
                    case "queue_songs": {
                        const blocked = locked();
                        if (blocked) return blocked;
                        const tracks = (await songsOf(args)).slice(
                            0,
                            MAX_SONGS,
                        );
                        if (tracks.length === 0) {
                            return {
                                error: "Apple Music could not find any of those songs.",
                            };
                        }
                        if (!playback?.activeTrack) {
                            // nothing to queue after, so they play
                            await commands.playQueue({ tracks, startIndex: 0 });
                            return {
                                playing: tracks.length,
                                note: "Nothing was playing, so these started playing.",
                            };
                        }
                        if (args.position === "next") {
                            await commands.playNext(tracks);
                        } else {
                            await commands.addToQueue(tracks);
                        }
                        return {
                            queued: tracks.length,
                            position: args.position === "next" ? "next" : "end",
                        };
                    }
                    case "set_shuffle": {
                        const blocked = locked();
                        if (blocked) return blocked;
                        const on = args.on === true;
                        await commands.setShuffleMode(
                            on ? ShuffleMode.Songs : ShuffleMode.Off,
                        );
                        return { shuffle: on ? "on" : "off" };
                    }
                    case "set_repeat": {
                        const blocked = locked();
                        if (blocked) return blocked;
                        const mode =
                            args.mode === "one"
                                ? RepeatMode.One
                                : args.mode === "all"
                                  ? RepeatMode.All
                                  : RepeatMode.Off;
                        await commands.setRepeatMode(mode);
                        return { repeat: mode };
                    }
                    case "search_apple_music": {
                        const term = stringOf(args.term);
                        if (!term) return { error: "term is required." };
                        const limit = clamp(numberOf(args.limit) ?? 10, 1, 25);
                        const result = await readAppleMusic(() =>
                            MusicKit.catalogSearch(term, ["songs"], { limit }),
                        );
                        const songs = result.songs;
                        return {
                            found: songs.length,
                            songs: songs.map(describe),
                            card: cardOf(songs, stringOf(args.title) ?? term),
                        };
                    }
                    case "apple_music_playlists": {
                        const filter = stringOf(
                            args.name_contains,
                        )?.toLowerCase();
                        const playlists = (await userPlaylists()).filter(
                            (playlist) =>
                                !filter ||
                                playlist.title.toLowerCase().includes(filter),
                        );
                        return {
                            playlists: playlists.map((playlist) => ({
                                id: playlist.id,
                                name: playlist.title,
                            })),
                        };
                    }
                    case "apple_music_playlist_songs": {
                        const id = stringOf(args.playlist_id);
                        if (!id) return { error: "playlist_id is required." };
                        const tracks = await playlistTracks(id);
                        return {
                            name: playlistNames.get(id),
                            total: tracks.length,
                            songs: tracks.slice(0, MAX_DESCRIBED).map(describe),
                            card: cardOf(tracks, playlistNames.get(id)),
                        };
                    }
                    case "favorite_song": {
                        const songId =
                            args.song_id === "current"
                                ? playback?.activeTrack
                                    ? songIdOf(playback.activeTrack)
                                    : null
                                : stringOf(args.song_id);
                        if (!songId) return { error: "Nothing is playing." };
                        const favorite = args.favorite !== false;
                        const status = await MusicKit.setSongFavoriteStatus(
                            songId,
                            favorite,
                        );
                        // the heart on the player reads this cache
                        void mutate(
                            (key) =>
                                Array.isArray(key) &&
                                key[0] === "MusicKit.getSongFavoriteStatus" &&
                                key[2] === songId,
                            status,
                            { revalidate: false },
                        );
                        try {
                            await recordEvent(
                                status.isFavorite
                                    ? "song_favorited"
                                    : "song_unfavorited",
                                songId,
                            );
                        } catch (error) {
                            // the favorite itself went through
                            logHandledError(
                                "Recording a favorite change failed",
                                error,
                            );
                        }
                        return { song_id: songId, favorite: status.isFavorite };
                    }
                    case "create_apple_music_playlist": {
                        const playlistName = stringOf(args.name);
                        if (!playlistName)
                            return { error: "name is required." };
                        const ids = songIdsOf(args).slice(0, MAX_SONGS);
                        const playlist = await createPlaylist(
                            playlistName,
                            ids,
                        );
                        playlistNames.set(playlist.id, playlistName);
                        return {
                            created: playlistName,
                            playlist_id: playlist.id,
                            songs: ids.length,
                        };
                    }
                    case "add_to_apple_music_playlist": {
                        const id = stringOf(args.playlist_id);
                        if (!id) return { error: "playlist_id is required." };
                        const ids = songIdsOf(args).slice(0, MAX_SONGS);
                        await addSongsToPlaylist(id, ids);
                        return {
                            added: ids.length,
                            playlist:
                                stringOf(args.playlist_name) ??
                                playlistNames.get(id),
                        };
                    }
                    case "open_screen":
                        return await openScreenFor(args, openScreen, router);
                    default:
                        return {
                            error: `The phone has no tool named ${name}.`,
                        };
                }
            } catch (error) {
                logHandledError(`Assistant phone tool ${name} failed`, error);
                return {
                    error: `It did not work: ${error instanceof Error ? error.message : "something went wrong"}.`,
                };
            }
        },
        [
            addSongsToPlaylist,
            commands,
            createPlaylist,
            mutate,
            openScreen,
            recordEvent,
            router,
            songsOf,
        ],
    );
}

/**
 * Opens the screen `open_screen` names, closing the assistant sheet. An artist
 * id is checked with Apple first, so an id the model got wrong comes back as an
 * error it can fix instead of a page that cannot load.
 */
async function openScreenFor(
    args: ToolArgs,
    openScreen: ReturnType<typeof useOpenScreen>,
    router: ReturnType<typeof useRouter>,
): Promise<ToolOutput> {
    const screen = stringOf(args.screen) ?? "";
    const id = stringOf(args.id);
    const tab = TABS[screen];
    if (tab) {
        // close the assistant sheet, then switch tabs underneath it
        if (router.canDismiss()) router.dismiss();
        router.navigate(tab);
        return { opened: screen };
    }
    const sheet = SHEETS[screen];
    if (sheet) {
        // a settings sheet takes the assistant sheet's place
        router.replace(sheet);
        return { opened: screen };
    }
    if (screen === "now_playing") {
        if (!currentPlayback()?.activeTrack) {
            return {
                error: "Nothing is playing, so there is no player to open.",
            };
        }
        router.replace("/player");
        return { opened: screen };
    }
    if (!id) return { error: `${screen} needs an id.` };
    if (screen === "artist") {
        try {
            await readAppleMusic(() => MusicKit.getArtist(id));
        } catch {
            return {
                error: "Apple Music has no artist with that id. Look the artist up with find_artist and use its artist_id.",
            };
        }
    }
    if (screen === "album") {
        // Apple's own album item, which proves the id and carries the title and
        // artwork the album page draws before its own fetch lands
        const album = await readAppleMusic(() =>
            MusicKit.getCollectionInfo("albums", [id]),
        ).catch(() => []);
        if (album.length === 0) {
            return {
                error: "Apple Music has no album with that id. Look the album up with find_album and use its album_id.",
            };
        }
        openScreen(collectionRoute(album[0]) as Href, { closing: "assistant" });
        return { opened: screen, id, name: album[0].title };
    }
    const href: Href | null =
        screen === "tag"
            ? (`/tag/${encodeURIComponent(id)}` as Href)
            : screen === "saved_query"
              ? ({ pathname: "/query-results", params: { saved: id } } as Href)
              : screen === "shared_playlist"
                ? (`/shared-playlist/${encodeURIComponent(id)}` as Href)
                : screen === "song_discussion"
                  ? ({
                        pathname: "/discuss/[songId]",
                        params: { songId: id },
                    } as Href)
                  : screen === "artist"
                    ? (`/artist/${encodeURIComponent(id)}` as Href)
                    : screen === "apple_music_playlist"
                      ? ({
                            pathname: "/collection/[kind]/[id]",
                            params: {
                                kind: "playlist",
                                id,
                                title: playlistNames.get(id) ?? "",
                            },
                        } as Href)
                      : null;
    if (!href) return { error: `There is no screen called ${screen}.` };
    openScreen(href, { closing: "assistant" });
    return { opened: screen, id };
}

/** A song as the model sees it. */
function describe(track: MusicItem) {
    return {
        song_id: songIdOf(track),
        title: track.title,
        artist: track.artistName ?? null,
        album: track.albumName ?? null,
        artist_id: track.artistId ?? null,
        album_id: track.albumID ?? null,
    };
}

/** The id tags and the backend use for a song. */
function songIdOf(track: MusicItem) {
    return track.catalogId ?? track.id;
}

/** A card for `tracks`, or undefined for none. */
function cardOf(tracks: readonly MusicItem[], title?: string) {
    if (tracks.length === 0) return undefined;
    return {
        song_ids: tracks.slice(0, MAX_SONGS).map(songIdOf),
        total: tracks.length,
        title,
    };
}

/** The user's Apple Music library playlists, remembering their names. */
async function userPlaylists(): Promise<MusicItem[]> {
    const playlists: MusicItem[] = [];
    for (
        let offset = 0;
        playlists.length < MAX_PLAYLISTS;
        offset += PAGE_SIZE
    ) {
        const page = await readAppleMusic(() =>
            MusicKit.getUserPlaylists({ limit: PAGE_SIZE, offset }),
        );
        playlists.push(...page.items);
        if (!page.hasNextPage || page.items.length === 0) break;
    }
    for (const playlist of playlists)
        playlistNames.set(playlist.id, playlist.title);
    return playlists.slice(0, MAX_PLAYLISTS);
}

/** The songs of an Apple Music library playlist, in order, up to `MAX_SONGS`. */
async function playlistTracks(playlistId: string): Promise<MusicItem[]> {
    const tracks: MusicItem[] = [];
    for (let offset = 0; tracks.length < MAX_SONGS; offset += PAGE_SIZE) {
        const page = await readAppleMusic(() =>
            MusicKit.getPlaylistSongs(playlistId, { limit: PAGE_SIZE, offset }),
        );
        tracks.push(...page.items);
        if (!page.hasNextPage || page.items.length === 0) break;
    }
    return tracks.slice(0, MAX_SONGS);
}

function songIdsOf(args: ToolArgs): string[] {
    return Array.isArray(args.songs)
        ? args.songs.filter((id): id is string => typeof id === "string")
        : [];
}

function stringOf(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOf(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Math.round(value)));
}

/** A shuffled copy of `items` (Fisher-Yates). */
export function shuffledCopy<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
