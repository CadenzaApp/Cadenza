// A stand-in for the AppleMusicKit native module, used by ./index when
// EXPO_PUBLIC_MOCK_MUSICKIT is set, so the app can be worked on in Expo Go or
// without an Apple Music subscription.
//
// Answers come from the fixtures in ./mock-data and follow what the native
// implementations do: ids keep their catalog / "i." library split, getSongInfo
// preserves the requested order and drops ids it cannot find, the same limits
// apply (20 for search, 50 for library requests), and setPlaybackQueue rejects
// queue types the native side does not support. Playback is bookkeeping only -
// nothing makes sound - but the queue moves the way the real player's would.

import type { EventSubscription } from "expo-modules-core";
import type { AppleMusicKitNativeModule } from "./index";
import {
    LibraryResult,
    MusicItem,
    MusicKitOptions,
    SearchResult,
    AuthStatus,
    AuthResult,
    PlaybackQueueType,
} from "./AppleMusicKit.types";

function mockArtworkUrl(seed: string) {
    return `https://picsum.photos/seed/${seed}/200/200`;
}

export const MOCK_AUTH_RESULT: AuthResult = {
    status: AuthStatus.Authorized,
    userToken: "mock-user-token",
};

export const MOCK_AUTH_DENIED_RESULT: AuthResult = {
    status: AuthStatus.Denied,
    error: "The user denied access to Apple Music.",
};

export const MOCK_CATALOG_SONGS: MusicItem[] = [
    {
        id: "1490401244",
        title: "Blinding Lights",
        artistName: "The Weeknd",
        artworkUrl: mockArtworkUrl("after-hours"),
        playbackType: PlaybackQueueType.Song,
        albumID: "1499378108",
        albumName: "After Hours",
        songDuration: 200,
        releaseDate: Date.UTC(2019, 10, 29),
        genres: ["Pop", "R&B/Soul"],
    },
    {
        id: "1615585008",
        title: "As It Was",
        artistName: "Harry Styles",
        artworkUrl: mockArtworkUrl("harrys-house"),
        playbackType: PlaybackQueueType.Song,
        albumID: "1615584999",
        albumName: "Harry's House",
        songDuration: 167,
        releaseDate: Date.UTC(2022, 3, 1),
        genres: ["Pop"],
    },
    {
        id: "1544319711",
        title: "Good Days",
        artistName: "SZA",
        artworkUrl: mockArtworkUrl("good-days"),
        playbackType: PlaybackQueueType.Song,
        albumID: "1544319709",
        albumName: "Good Days - Single",
        songDuration: 279,
        releaseDate: Date.UTC(2020, 11, 25),
        genres: ["R&B/Soul"],
    },
    {
        id: "1497787101",
        title: "Levitating",
        artistName: "Dua Lipa",
        artworkUrl: mockArtworkUrl("future-nostalgia"),
        playbackType: PlaybackQueueType.Song,
        albumID: "1497787091",
        albumName: "Future Nostalgia",
        songDuration: 203,
        releaseDate: Date.UTC(2020, 2, 27),
        genres: ["Pop", "Dance"],
    },
    {
        id: "1440833098",
        title: "Dreams",
        artistName: "Fleetwood Mac",
        artworkUrl: mockArtworkUrl("rumours"),
        playbackType: PlaybackQueueType.Song,
        albumID: "1440833080",
        albumName: "Rumours",
        songDuration: 257,
        releaseDate: Date.UTC(1977, 1, 4),
        genres: ["Rock"],
    },
    {
        id: "1436314155",
        title: "Redbone",
        artistName: "Childish Gambino",
        artworkUrl: mockArtworkUrl("awaken-my-love"),
        playbackType: PlaybackQueueType.Song,
        albumID: "1436314127",
        albumName: '"Awaken, My Love!"',
        songDuration: 326,
        releaseDate: Date.UTC(2016, 11, 2),
        genres: ["R&B/Soul", "Funk"],
    },

    // emoji and mixed scripts in every text field
    {
        id: "1700000001",
        title: "🌙 midnight bloom 🌸 (sped up + reverb) 💫",
        artistName: "🦋 lilac ✨",
        artworkUrl: mockArtworkUrl("midnight-bloom"),
        playbackType: PlaybackQueueType.Song,
        albumID: "1700000000",
        albumName: "🌙🌙🌙",
        songDuration: 124,
        releaseDate: Date.UTC(2024, 5, 21),
        genres: ["Electronic", "🎧 Chill"],
    },
    {
        id: "1700000002",
        title: "دقات قلب - Live from القاهرة",
        artistName: "عمرو دياب",
        artworkUrl: mockArtworkUrl("rtl-mixed"),
        playbackType: PlaybackQueueType.Song,
        albumID: "1700000003",
        albumName: "الليلة",
        songDuration: 341,
        releaseDate: Date.UTC(2013, 6, 30),
        genres: ["Worldwide", "Pop"],
    },

    // long enough to overflow anything that is not truncating
    {
        id: "1700000004",
        title: "The Sound of the Life of the Mind (Extended Director's Cut) [feat. Everyone Who Was in the Room That Day] - Remastered 2019 Anniversary Edition",
        artistName:
            "A Band With an Unreasonably Long Name and No Regrets About It",
        artworkUrl: mockArtworkUrl("very-long-title"),
        playbackType: PlaybackQueueType.Song,
        albumID: "1700000005",
        albumName:
            "An Album Title That Also Refuses to End Before the Second Line Wraps",
        songDuration: 5999.4,
        releaseDate: Date.UTC(2019, 8, 13),
        genres: [
            "Rock",
            "Alternative",
            "Indie Rock",
            "Power Pop",
            "Punk",
            "Emo",
            "Post-Hardcore",
        ],
    },

    // artwork present but not an http url - should fall back, not render
    {
        id: "1700000006",
        title: "Ceremony",
        artistName: "New Order",
        artworkUrl: "musickit://artwork/unavailable",
        playbackType: PlaybackQueueType.Song,
        albumID: "1700000007",
        albumName: "Movement",
        songDuration: 264,
        releaseDate: Date.UTC(1981, 2, 13),
        genres: ["Post-Punk"],
    },
];

export const MOCK_LIBRARY_SONGS: MusicItem[] = [
    {
        id: "i.4YZ8Kq0TmEXbN",
        title: "Alright",
        artistName: "Kendrick Lamar",
        artworkUrl: mockArtworkUrl("to-pimp-a-butterfly"),
        playbackType: PlaybackQueueType.LibrarySong,
        albumID: "l.9Vd2QwR",
        albumName: "To Pimp a Butterfly",
        songDuration: 219,
        releaseDate: Date.UTC(2015, 2, 15),
        genres: ["Hip-Hop/Rap"],
    },
    {
        id: "i.7Bm3XpLdQvWzR",
        title: "Weird Fishes / Arpeggi",
        artistName: "Radiohead",
        artworkUrl: mockArtworkUrl("in-rainbows"),
        playbackType: PlaybackQueueType.LibrarySong,
        albumID: "l.2Kf8LpN",
        albumName: "In Rainbows",
        songDuration: 318,
        releaseDate: Date.UTC(2007, 9, 10),
        genres: ["Alternative", "Rock"],
    },
    {
        id: "i.QnR6ZvJyLdM2W",
        title: "Motion Sickness",
        artistName: "Phoebe Bridgers",
        artworkUrl: mockArtworkUrl("stranger-in-the-alps"),
        playbackType: PlaybackQueueType.LibrarySong,
        albumID: "l.5Tq1BmZ",
        albumName: "Stranger in the Alps",
        songDuration: 240,
        releaseDate: Date.UTC(2017, 8, 22),
        genres: ["Alternative", "Singer/Songwriter"],
    },
    {
        id: "i.8LdWq2NvXbT5K",
        title: "Bags",
        artistName: "Clairo",
        artworkUrl: mockArtworkUrl("immunity"),
        playbackType: PlaybackQueueType.LibrarySong,
        albumID: "l.3Hn7YcV",
        albumName: "Immunity",
        songDuration: 258,
        releaseDate: Date.UTC(2019, 7, 2),
        genres: ["Alternative", "Pop"],
    },
    {
        id: "i.MvZ3TqXwK8RbL",
        title: "電光石火",
        artistName: "羊文学",
        artworkUrl: mockArtworkUrl("our-hope"),
        playbackType: PlaybackQueueType.LibrarySong,
        albumID: "l.4Cm9RtW",
        albumName: "our hope",
        songDuration: 232,
        releaseDate: Date.UTC(2022, 3, 13),
        genres: ["J-Rock", "Alternative"],
    },
    {
        id: "i.RbK9WmT2LqXvZ",
        title: "Passionfruit",
        artistName: "Drake",
        artworkUrl: mockArtworkUrl("more-life"),
        playbackType: PlaybackQueueType.LibrarySong,
        albumID: "l.8Zx5NpK",
        albumName: "More Life",
        songDuration: 298,
        releaseDate: Date.UTC(2017, 2, 18),
        genres: ["Hip-Hop/Rap", "Dance"],
    },

    // only the fields the native side always sets - everything optional missing
    {
        id: "i.ZvX2NqLbW9TmK",
        title: "Untitled Voice Memo",
        playbackType: PlaybackQueueType.LibrarySong,
    },

    // present but empty: android writes "" for artwork it cannot resolve, and
    // uploaded library files often have blank tags
    {
        id: "i.Wq5LmZbX3TvNK",
        title: "",
        artistName: "   ",
        artworkUrl: "",
        playbackType: PlaybackQueueType.LibrarySong,
        albumName: "",
        songDuration: 0,
        releaseDate: 0,
        genres: [],
    },

    // a newline in the middle of a title, straight off a badly tagged rip
    {
        id: "i.Nk8TqWmZ2LbXv",
        title: "track 07\n(hidden track)",
        artistName: "Unknown Artist",
        artworkUrl: mockArtworkUrl("hidden-track"),
        playbackType: PlaybackQueueType.LibrarySong,
        albumName: "bootleg \\ 1998 // side b",
        songDuration: 47.2,
        genres: ["Unknown"],
    },

    // dated in the future, which the store does allow for pre-releases
    {
        id: "i.Lb3XvNkWq8TmZ",
        title: "彼女は 🎐 (Pre-Release)",
        artistName: "ずっと真夜中でいいのに。",
        artworkUrl: mockArtworkUrl("pre-release"),
        playbackType: PlaybackQueueType.LibrarySong,
        albumID: "l.7Qw3NmT",
        albumName: "TBA",
        songDuration: 211,
        releaseDate: Date.UTC(2030, 0, 1),
        genres: ["J-Pop"],
    },
];

/** catalogSearch only fills id/title/artistName/artworkUrl for albums. */
export const MOCK_ALBUMS: MusicItem[] = [
    {
        id: "1499378108",
        title: "After Hours",
        artistName: "The Weeknd",
        artworkUrl: mockArtworkUrl("after-hours"),
    },
    {
        id: "1615584999",
        title: "Harry's House",
        artistName: "Harry Styles",
        artworkUrl: mockArtworkUrl("harrys-house"),
    },
    {
        id: "1497787091",
        title: "Future Nostalgia",
        artistName: "Dua Lipa",
        artworkUrl: mockArtworkUrl("future-nostalgia"),
    },
    {
        id: "1440833080",
        title: "Rumours",
        artistName: "Fleetwood Mac",
        artworkUrl: mockArtworkUrl("rumours"),
    },
    {
        id: "1700000000",
        title: "🌙🌙🌙",
        artistName: "🦋 lilac ✨",
        artworkUrl: mockArtworkUrl("midnight-bloom"),
    },
    {
        id: "1700000008",
        title: "Untitled Album",
        // no artist, no artwork
    },
];

/** getUserPlaylists puts the curator name in artistName. */
export const MOCK_PLAYLISTS: MusicItem[] = [
    {
        id: "p.LV0PYJDC0b2klQ7",
        title: "Late Night Drive",
        artistName: "Troy",
        artworkUrl: mockArtworkUrl("late-night-drive"),
    },
    {
        id: "p.O1kz9WMuqNJb3Xd",
        title: "Focus Flow",
        artistName: "Apple Music",
        artworkUrl: mockArtworkUrl("focus-flow"),
    },
    {
        id: "p.8aVBmZ3TqLdW1Kx",
        title: "songs i cry to 😭😭😭 (do not open) 🔒",
        artistName: "Troy",
        artworkUrl: mockArtworkUrl("cry-playlist"),
    },
    {
        id: "p.qX7NvR2WbKmZ9Lt",
        title: "Rainy Day Indie",
        // no curator or artwork - both are optional on the native side
    },
];

/** getPlaylistSongs, keyed by playlist id. */
export const MOCK_PLAYLIST_TRACKS: Record<string, MusicItem[]> = {
    "p.LV0PYJDC0b2klQ7": [
        MOCK_LIBRARY_SONGS[1],
        MOCK_LIBRARY_SONGS[4],
        MOCK_LIBRARY_SONGS[5],
    ],
    "p.O1kz9WMuqNJb3Xd": [MOCK_LIBRARY_SONGS[1], MOCK_LIBRARY_SONGS[9]],
    "p.8aVBmZ3TqLdW1Kx": [
        MOCK_LIBRARY_SONGS[0],
        MOCK_LIBRARY_SONGS[3],
        MOCK_LIBRARY_SONGS[6],
        MOCK_LIBRARY_SONGS[7],
        MOCK_LIBRARY_SONGS[8],
    ],
    // an empty playlist
    "p.qX7NvR2WbKmZ9Lt": [],
};

/** Native queries cross the bridge and hit the network - leave loading states time to show. */
const QUERY_LATENCY_MS = 220;

/** Player commands stay on the device, so they come back much sooner. */
const COMMAND_LATENCY_MS = 40;

/** Both native modules cap catalog search at 20 results. */
const SEARCH_LIMIT = 20;

/** Limit the native modules fall back to when the caller does not pass one. */
const DEFAULT_LIBRARY_LIMIT = 50;

const ALL_MOCK_SONGS = [...MOCK_CATALOG_SONGS, ...MOCK_LIBRARY_SONGS];
const MOCK_SONGS_BY_ID = new Map(ALL_MOCK_SONGS.map((song) => [song.id, song]));

function respond<T>(value: T, latency = QUERY_LATENCY_MS): Promise<T> {
    return new Promise((resolve) => setTimeout(() => resolve(value), latency));
}

function matchesQuery(item: MusicItem, query: string) {
    return [item.title, item.artistName, item.albumName].some((field) =>
        field?.toLowerCase().includes(query),
    );
}

/** Mirrors setPlaybackQueue on the native side, down to its rejection of unknown types. */
function buildQueue(id: string, type: string): MusicItem[] {
    switch (type.toLowerCase()) {
        case "song":
        case "librarysong": {
            const song = MOCK_SONGS_BY_ID.get(id);
            return song ? [song] : [];
        }
        case "album":
            return ALL_MOCK_SONGS.filter((song) => song.albumID === id);
        case "playlist":
            return MOCK_PLAYLIST_TRACKS[id] ?? [];
        default:
            throw new Error(`Unsupported queue type: ${type}`);
    }
}

export function createMockNativeModule(): AppleMusicKitNativeModule {
    let isPlaying = false;
    let queue: MusicItem[] = [];
    let queueIndex = 0;
    // Nothing in the module reads the position back yet; it is kept so seeking
    // and restarting have something to act on.
    let playbackTime = 0;

    // Registered but never called: both native modules declare
    // "onPlaybackStateChange" without ever sending it, and ./index keeps the
    // playing state itself, so emitting here would double-toggle it.
    const listeners = new Map<string, Set<(...args: any[]) => void>>();

    return {
        authorize: (_developerToken: string) => respond(MOCK_AUTH_RESULT),

        setTokens: (_developerToken: string, _userToken: string | null) =>
            respond(undefined, COMMAND_LATENCY_MS),

        play: () => {
            isPlaying = true;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        pause: () => {
            isPlaying = false;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        togglePlayerState: () => {
            isPlaying = !isPlaying;
            return respond(isPlaying, COMMAND_LATENCY_MS);
        },

        skipToNextEntry: () => {
            if (queueIndex < queue.length - 1) queueIndex++;
            playbackTime = 0;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        skipToPreviousEntry: () => {
            if (queueIndex > 0) queueIndex--;
            playbackTime = 0;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        restartCurrentEntry: () => {
            playbackTime = 0;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        seekToTime: (time: number) => {
            const duration = queue[queueIndex]?.songDuration;
            playbackTime = Math.max(
                0,
                duration === undefined ? time : Math.min(time, duration),
            );
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        getSongInfo: (ids: string[]) =>
            respond(
                ids
                    .map((id) => MOCK_SONGS_BY_ID.get(id))
                    .filter((song) => song !== undefined),
            ),

        catalogSearch: (query: string, types: string[]) => {
            const term = query.trim().toLowerCase();
            return respond<SearchResult>({
                songs: types.includes("songs")
                    ? MOCK_CATALOG_SONGS.filter((song) =>
                          matchesQuery(song, term),
                      ).slice(0, SEARCH_LIMIT)
                    : [],
                albums: types.includes("albums")
                    ? MOCK_ALBUMS.filter((album) =>
                          matchesQuery(album, term),
                      ).slice(0, SEARCH_LIMIT)
                    : [],
            });
        },

        getTracksFromLibrary: () =>
            respond<LibraryResult>({
                items: MOCK_LIBRARY_SONGS.slice(0, DEFAULT_LIBRARY_LIMIT),
            }),

        getUserPlaylists: (options?: MusicKitOptions) =>
            respond<LibraryResult>({
                items: MOCK_PLAYLISTS.slice(
                    0,
                    options?.limit ?? DEFAULT_LIBRARY_LIMIT,
                ),
            }),

        getLibrarySongs: (options?: MusicKitOptions) =>
            respond<LibraryResult>({
                items: MOCK_LIBRARY_SONGS.slice(
                    0,
                    options?.limit ?? DEFAULT_LIBRARY_LIMIT,
                ),
            }),

        getPlaylistSongs: (playlistId: string) =>
            respond<LibraryResult>({
                items: MOCK_PLAYLIST_TRACKS[playlistId] ?? [],
            }),

        setPlaybackQueue: (id: string, type: string) => {
            queue = buildQueue(id, type);
            queueIndex = 0;
            playbackTime = 0;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        addListener: (
            eventName: string,
            listener: (...args: any[]) => void,
        ): EventSubscription => {
            const forEvent = listeners.get(eventName) ?? new Set();
            forEvent.add(listener);
            listeners.set(eventName, forEvent);

            return {
                remove: () => {
                    forEvent.delete(listener);
                },
            };
        },

        removeListeners: (_count: number) => {
        },
    };
}
