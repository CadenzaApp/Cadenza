// A stand-in for the AppleMusicKit native module, used by ./index when
// EXPO_PUBLIC_MOCK_MUSICKIT is set, so the app can be worked on in Expo Go or
// without an Apple Music subscription.
//
// Answers come from local fixtures and follow the refactored native contract:
// ids retain their catalog / "i." library split, getSongInfo preserves requested
// order, collection calls paginate, favorites are mutable, and playback exposes
// simulated snapshots. Playback is bookkeeping only; nothing makes sound.

import type { AppleMusicKitNativeModule } from "./index";
import {
    ArtistDetail,
    ArtistItem,
    ArtistResult,
    LibraryResult,
    LibrarySongOptions,
    MusicItem,
    MusicKitOptions,
    MusicResourceSource,
    RepeatMode,
    SearchResult,
    ShuffleMode,
    AuthStatus,
    AuthResult,
    PlaybackQueueType,
    PlaybackSnapshot,
    SongFavoriteStatus,
} from "./AppleMusicKit.types";

type MockItemInput = Partial<MusicItem> & Pick<MusicItem, "id" | "title">;

function normalizeMockItems(
    items: MockItemInput[],
    resourceKind: MusicItem["resourceKind"],
    source: MusicItem["source"],
    playbackType: PlaybackQueueType,
): MusicItem[] {
    return items.map((item) => ({
        ...item,
        resourceKind,
        source,
        playbackType: item.playbackType ?? playbackType,
        catalogId:
            source === "catalog" ? (item.catalogId ?? item.id) : item.catalogId,
        libraryId:
            source === "library" ? (item.libraryId ?? item.id) : item.libraryId,
        artistId: item.artistId ?? mockArtistId(item.artistName),
        artworkUrlLarge:
            item.artworkUrlLarge ??
            item.artworkUrl?.replace("/200/200", "/1200/1200"),
        shareUrl:
            item.shareUrl ??
            (source === "catalog"
                ? `https://music.apple.com/us/${resourceKind}/${encodeURIComponent(item.id)}`
                : undefined),
    }));
}

/**
 * Derived from the name so the fixtures do not have to carry one each. Every
 * song by the same artist lands on the same id, which is all the artist screen
 * needs.
 */
function mockArtistId(artistName?: string): string | undefined {
    const normalized = artistName?.trim();
    if (!normalized) return undefined;
    return `a.${encodeURIComponent(normalized.toLowerCase())}`;
}

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

const RAW_MOCK_CATALOG_SONGS: MockItemInput[] = [
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

export const MOCK_CATALOG_SONGS = normalizeMockItems(
    RAW_MOCK_CATALOG_SONGS,
    "song",
    "catalog",
    PlaybackQueueType.Song,
);

const RAW_MOCK_LIBRARY_SONGS: MockItemInput[] = [
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

export const MOCK_LIBRARY_SONGS = normalizeMockItems(
    RAW_MOCK_LIBRARY_SONGS,
    "song",
    "library",
    PlaybackQueueType.LibrarySong,
).map((song, index) => ({
    ...song,
    libraryAddedDate: Date.UTC(2024, 0, index + 1),
}));

/** catalogSearch only fills id/title/artistName/artworkUrl for albums. */
const RAW_MOCK_ALBUMS: MockItemInput[] = [
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

export const MOCK_ALBUMS = normalizeMockItems(
    RAW_MOCK_ALBUMS,
    "album",
    "catalog",
    PlaybackQueueType.Album,
);

/** getUserPlaylists puts the curator name in artistName. */
const RAW_MOCK_PLAYLISTS: MockItemInput[] = [
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

export const MOCK_PLAYLISTS = normalizeMockItems(
    RAW_MOCK_PLAYLISTS,
    "playlist",
    "library",
    PlaybackQueueType.Playlist,
);

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

/**
 * getLibraryAlbums and getAlbumSongs, derived from the library songs rather
 * than written out, so every album the list shows actually has tracks behind
 * it and the two can never drift apart.
 */
const MOCK_LIBRARY_ALBUM_TRACKS = new Map<string, MusicItem[]>();
for (const song of MOCK_LIBRARY_SONGS) {
    if (!song.albumID) continue;
    const tracks = MOCK_LIBRARY_ALBUM_TRACKS.get(song.albumID);
    if (tracks) tracks.push(song);
    else MOCK_LIBRARY_ALBUM_TRACKS.set(song.albumID, [song]);
}

export const MOCK_LIBRARY_ALBUMS = normalizeMockItems(
    [...MOCK_LIBRARY_ALBUM_TRACKS].map(([albumID, tracks]) => ({
        id: albumID,
        title: tracks[0].albumName ?? "Unknown Album",
        artistName: tracks[0].artistName,
        artworkUrl: tracks[0].artworkUrl,
    })),
    "album",
    "library",
    PlaybackQueueType.Album,
);

/**
 * getRecentlyAdded. Mixed on purpose: the real endpoint returns whole albums
 * and playlists alongside the songs that were added on their own, so the mock
 * interleaves the three kinds instead of listing every song.
 */
export const MOCK_RECENTLY_ADDED = interleaveMockItems([
    MOCK_LIBRARY_ALBUMS,
    MOCK_PLAYLISTS,
    MOCK_LIBRARY_SONGS.filter((song) => !song.albumID),
]);

/** Native queries cross the bridge and hit the network - leave loading states time to show. */
const QUERY_LATENCY_MS = 220;

/** Player commands stay on the device, so they come back much sooner. */
const COMMAND_LATENCY_MS = 40;

/** Both native modules cap catalog search at 20 results. */
const SEARCH_LIMIT = 20;

/** Limit the native modules fall back to when the caller does not pass one. */
const DEFAULT_LIBRARY_LIMIT = 50;

const ALL_MOCK_SONGS = [...MOCK_CATALOG_SONGS, ...MOCK_LIBRARY_SONGS];
const MOCK_SONGS_BY_ID = new Map<string, MusicItem>();
for (const song of ALL_MOCK_SONGS) {
    for (const id of [song.id, song.catalogId, song.libraryId]) {
        if (id) MOCK_SONGS_BY_ID.set(id, song);
    }
}
const MOCK_FAVORITE_IDS = new Set<string>([
    MOCK_CATALOG_SONGS[0].id,
    MOCK_LIBRARY_SONGS[1].id,
]);

/**
 * Artists, derived from the song fixtures the same way the library albums are.
 * `mockArtistId` already stamps every song with an id built from its artist
 * name, so uniquing on that id gives one artist per name without the fixtures
 * carrying an artist list that could drift.
 */
function deriveMockArtists(
    songs: MusicItem[],
    source: MusicResourceSource,
): ArtistItem[] {
    const byId = new Map<string, ArtistItem>();
    for (const song of songs) {
        if (!song.artistId || !song.artistName) continue;
        if (byId.has(song.artistId)) continue;
        byId.set(song.artistId, {
            id: song.artistId,
            name: song.artistName,
            artworkUrl: song.artworkUrl,
            source,
            // Mock library artists always resolve, so the tap path into the
            // catalog artist screen is exercisable in Expo Go.
            catalogId: song.artistId,
            libraryId:
                source === "library" ? `r.${song.artistId}` : undefined,
        });
    }
    return [...byId.values()];
}

const MOCK_CATALOG_ARTISTS = deriveMockArtists(MOCK_CATALOG_SONGS, "catalog");
const MOCK_LIBRARY_ARTISTS = deriveMockArtists(MOCK_LIBRARY_SONGS, "library");

function matchesArtistQuery(artist: ArtistItem, query: string) {
    return artist.name.toLowerCase().includes(query);
}

/** The artist counterpart to `paginatedResult`. */
function paginatedArtistResult(
    artists: ArtistItem[],
    options?: MusicKitOptions,
): ArtistResult {
    const limit = Math.max(
        1,
        Math.trunc(options?.limit ?? DEFAULT_LIBRARY_LIMIT),
    );
    const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
    const items = artists.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    const hasNextPage = nextOffset < artists.length;
    return {
        items,
        hasNextPage,
        nextOffset: hasNextPage ? nextOffset : undefined,
    };
}

function respond<T>(value: T, latency = QUERY_LATENCY_MS): Promise<T> {
    return new Promise((resolve) => setTimeout(() => resolve(value), latency));
}

function matchesQuery(item: MusicItem, query: string) {
    return [item.title, item.artistName, item.albumName].some((field) =>
        field?.toLowerCase().includes(query),
    );
}

/** Round-robins the groups so every kind shows up near the top of the feed. */
function interleaveMockItems(groups: MusicItem[][]): MusicItem[] {
    const longest = Math.max(0, ...groups.map((group) => group.length));
    const items: MusicItem[] = [];
    for (let index = 0; index < longest; index += 1) {
        for (const group of groups) {
            const item = group[index];
            if (item) items.push(item);
        }
    }
    return items;
}

function paginatedResult(
    items: MusicItem[],
    options: MusicKitOptions = {},
): LibraryResult {
    const limit = Math.min(
        100,
        Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIBRARY_LIMIT)),
    );
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const pageItems = items.slice(offset, offset + limit);
    const nextOffset = offset + pageItems.length;
    return {
        items: pageItems,
        hasNextPage: nextOffset < items.length,
        nextOffset: nextOffset < items.length ? nextOffset : undefined,
    };
}

function sortedLibrarySongs(options?: LibrarySongOptions) {
    const sort = options?.sort;
    if (!sort) return MOCK_LIBRARY_SONGS;
    const direction = sort.direction === "ascending" ? 1 : -1;
    return [...MOCK_LIBRARY_SONGS].sort((left, right) => {
        if (sort.option === "dateAdded") {
            return (
                ((left.libraryAddedDate ?? 0) - (right.libraryAddedDate ?? 0)) *
                direction
            );
        }

        const field = {
            title: "title",
            artist: "artistName",
            album: "albumName",
        }[sort.option] as "title" | "artistName" | "albumName";
        return (
            (left[field] ?? "").localeCompare(right[field] ?? "") * direction
        );
    });
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
    let playbackTime = 0;
    let playbackStartedAt: number | null = null;
    let shuffleMode = ShuffleMode.Off;
    let repeatMode = RepeatMode.Off;
    // Playlists the mock session created, so a create then an add behaves the
    // same way it does against the real library.
    const createdPlaylists: MusicItem[] = [];

    function currentPlaybackTime(): number {
        const elapsed =
            isPlaying && playbackStartedAt !== null
                ? (Date.now() - playbackStartedAt) / 1000
                : 0;
        const duration = queue[queueIndex]?.songDuration;
        const current = playbackTime + elapsed;
        return duration === undefined ? current : Math.min(current, duration);
    }

    function stopPlaybackClock(): void {
        playbackTime = currentPlaybackTime();
        playbackStartedAt = null;
    }

    return {
        authorize: (_developerToken: string) => respond(MOCK_AUTH_RESULT),

        setTokens: (_developerToken: string, _userToken: string | null) =>
            respond(undefined, COMMAND_LATENCY_MS),

        play: () => {
            if (!isPlaying) playbackStartedAt = Date.now();
            isPlaying = true;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        pause: () => {
            stopPlaybackClock();
            isPlaying = false;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        togglePlayerState: () => {
            if (isPlaying) {
                stopPlaybackClock();
                isPlaying = false;
            } else {
                playbackStartedAt = Date.now();
                isPlaying = true;
            }
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        getPlaybackSnapshot: () => {
            const currentTrack = queue[queueIndex];
            const snapshot: PlaybackSnapshot = {
                isPlaying,
                isLoading: false,
                progress: currentPlaybackTime(),
                duration: currentTrack?.songDuration,
                currentTrack,
                shuffleMode,
                repeatMode,
            };
            return respond(snapshot, COMMAND_LATENCY_MS);
        },

        skipToNextEntry: () => {
            if (queueIndex < queue.length - 1) queueIndex++;
            playbackTime = 0;
            playbackStartedAt = isPlaying ? Date.now() : null;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        skipToPreviousEntry: () => {
            if (queueIndex > 0) queueIndex--;
            playbackTime = 0;
            playbackStartedAt = isPlaying ? Date.now() : null;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        restartCurrentEntry: () => {
            playbackTime = 0;
            playbackStartedAt = isPlaying ? Date.now() : null;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        seekToTime: (time: number) => {
            const duration = queue[queueIndex]?.songDuration;
            playbackTime = Math.max(
                0,
                duration === undefined ? time : Math.min(time, duration),
            );
            playbackStartedAt = isPlaying ? Date.now() : null;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        getSongInfo: (ids: string[]) =>
            respond(
                ids
                    .map((id) => MOCK_SONGS_BY_ID.get(id))
                    .filter((song) => song !== undefined),
            ),

        catalogSearch: (
            query: string,
            types: string[],
            requestedLimit: number,
            requestedOffset: number,
        ) => {
            const term = query.trim().toLowerCase();
            const limit = Math.min(
                SEARCH_LIMIT,
                Math.max(1, Math.trunc(requestedLimit)),
            );
            const offset = Math.max(0, Math.trunc(requestedOffset));
            const songs = types.includes("songs")
                ? MOCK_CATALOG_SONGS.filter((song) => matchesQuery(song, term))
                : [];
            const albums = types.includes("albums")
                ? MOCK_ALBUMS.filter((album) => matchesQuery(album, term))
                : [];
            const artists = types.includes("artists")
                ? MOCK_CATALOG_ARTISTS.filter((artist) =>
                      matchesArtistQuery(artist, term),
                  )
                : [];
            const pageSongs = songs.slice(offset, offset + limit);
            return respond<SearchResult>({
                songs: pageSongs,
                albums: albums.slice(offset, offset + limit),
                hasNextSongs: offset + limit < songs.length,
                hasNextAlbums: offset + limit < albums.length,
                artists: artists.slice(offset, offset + limit),
                hasNextArtists: offset + limit < artists.length,
                nextSongsOffset:
                    offset + pageSongs.length < songs.length
                        ? offset + pageSongs.length
                        : undefined,
            });
        },

        getUserPlaylists: (options?: MusicKitOptions) =>
            respond(paginatedResult(MOCK_PLAYLISTS, options)),

        getLibrarySongs: (options?: LibrarySongOptions) =>
            respond(paginatedResult(sortedLibrarySongs(options), options)),

        searchLibrarySongs: (term: string, options?: MusicKitOptions) =>
            respond(
                paginatedResult(
                    MOCK_LIBRARY_SONGS.filter((song) =>
                        matchesQuery(song, term.trim().toLowerCase()),
                    ),
                    options,
                ),
            ),

        getLibraryArtists: (options?: MusicKitOptions) =>
            respond(paginatedArtistResult(MOCK_LIBRARY_ARTISTS, options)),

        searchLibraryArtists: (term: string, options?: MusicKitOptions) =>
            respond(
                paginatedArtistResult(
                    MOCK_LIBRARY_ARTISTS.filter((artist) =>
                        matchesArtistQuery(artist, term.trim().toLowerCase()),
                    ),
                    options,
                ),
            ),

        getPlaylistSongs: (playlistId: string, options?: MusicKitOptions) =>
            respond(
                paginatedResult(
                    MOCK_PLAYLIST_TRACKS[playlistId] ?? [],
                    options,
                ),
            ),

        getLibraryAlbums: (options?: MusicKitOptions) =>
            respond(paginatedResult(MOCK_LIBRARY_ALBUMS, options)),

        getRecentlyAdded: (options?: MusicKitOptions) =>
            respond(paginatedResult(MOCK_RECENTLY_ADDED, options)),

        getAlbumSongs: (albumId: string, options?: MusicKitOptions) =>
            respond(
                paginatedResult(
                    MOCK_LIBRARY_ALBUM_TRACKS.get(albumId) ?? [],
                    options,
                ),
            ),

        getSongFavoriteStatus: (id: string) =>
            respond<SongFavoriteStatus>({
                isFavorite: MOCK_FAVORITE_IDS.has(id),
            }),

        setSongFavoriteStatus: (id: string, isFavorite: boolean) => {
            if (isFavorite) MOCK_FAVORITE_IDS.add(id);
            else MOCK_FAVORITE_IDS.delete(id);
            return respond<SongFavoriteStatus>({ isFavorite });
        },

        setPlaybackQueue: (id: string, type: string) => {
            queue = buildQueue(id, type);
            queueIndex = 0;
            playbackTime = 0;
            playbackStartedAt = null;
            isPlaying = false;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        setSongPlaybackQueue: (
            ids: readonly string[],
            types: readonly string[],
            startIndex: number,
        ) => {
            queue = ids.flatMap((id, index) =>
                buildQueue(id, types[index] ?? "song"),
            );
            queueIndex = Math.max(0, Math.min(startIndex, queue.length - 1));
            playbackTime = 0;
            playbackStartedAt = null;
            isPlaying = false;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        appendSongPlaybackQueue: (
            ids: readonly string[],
            types: readonly string[],
        ) => {
            queue.push(
                ...ids.flatMap((id, index) =>
                    buildQueue(id, types[index] ?? "song"),
                ),
            );
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        insertSongsNextInQueue: (
            ids: readonly string[],
            types: readonly string[],
        ) => {
            const songs = ids.flatMap((id, index) =>
                buildQueue(id, types[index] ?? "song"),
            );
            queue.splice(queueIndex + 1, 0, ...songs);
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        moveQueueItem: (fromIndex: number, toIndex: number) => {
            const from = boundedQueueIndex(fromIndex);
            const to = boundedQueueIndex(toIndex);
            if (from === null || to === null || from === to) {
                return respond(undefined, COMMAND_LATENCY_MS);
            }

            const [moved] = queue.splice(from, 1);
            queue.splice(to, 0, moved);
            // The playing entry keeps playing wherever it landed.
            if (from === queueIndex) queueIndex = to;
            else if (from < queueIndex && to >= queueIndex) queueIndex -= 1;
            else if (from > queueIndex && to <= queueIndex) queueIndex += 1;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        removeQueueItem: (index: number) => {
            const target = boundedQueueIndex(index);
            if (target === null) {
                return respond(undefined, COMMAND_LATENCY_MS);
            }

            queue.splice(target, 1);
            if (target < queueIndex) queueIndex -= 1;
            queueIndex = Math.max(0, Math.min(queueIndex, queue.length - 1));
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        playQueueItem: (index: number) => {
            const target = boundedQueueIndex(index);
            if (target === null || target === queueIndex) {
                return respond(undefined, COMMAND_LATENCY_MS);
            }

            // Skipping forward drops what was skipped over, the way Apple
            // Music's up-next list does. Skipping back just moves.
            if (target > queueIndex) {
                queue.splice(queueIndex + 1, target - queueIndex - 1);
                queueIndex += 1;
            } else {
                queueIndex = target;
            }
            playbackTime = 0;
            playbackStartedAt = isPlaying ? Date.now() : null;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        setShuffleMode: (mode: ShuffleMode) => {
            shuffleMode = mode;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        setRepeatMode: (mode: RepeatMode) => {
            repeatMode = mode;
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        addSongsToPlaylist: (playlistId: string, ids: readonly string[]) => {
            const tracks = ids
                .map((id) => MOCK_SONGS_BY_ID.get(id))
                .filter((song): song is MusicItem => song !== undefined);
            MOCK_PLAYLIST_TRACKS[playlistId] = [
                ...(MOCK_PLAYLIST_TRACKS[playlistId] ?? []),
                ...tracks,
            ];
            return respond(undefined, COMMAND_LATENCY_MS);
        },

        createPlaylist: (name: string, ids: readonly string[]) => {
            const playlist: MusicItem = {
                id: `p.mock-${createdPlaylists.length + 1}`,
                resourceKind: "playlist",
                source: "library",
                libraryId: `p.mock-${createdPlaylists.length + 1}`,
                title: name,
                playbackType: PlaybackQueueType.Playlist,
            };
            createdPlaylists.push(playlist);
            MOCK_PLAYLISTS.push(playlist);
            MOCK_PLAYLIST_TRACKS[playlist.id] = ids
                .map((id) => MOCK_SONGS_BY_ID.get(id))
                .filter((song): song is MusicItem => song !== undefined);
            return respond(playlist, COMMAND_LATENCY_MS);
        },

        getSongArtists: (songId: string) => {
            const song = MOCK_SONGS_BY_ID.get(songId);
            return respond(song?.artistId ? [song.artistId] : []);
        },

        getArtist: (artistId: string) => {
            const songs = ALL_MOCK_SONGS.filter(
                (song) => song.artistId === artistId,
            );
            const albumIds = new Set(
                songs.map((song) => song.albumID).filter(Boolean),
            );
            const artist: ArtistDetail = {
                id: artistId,
                name: songs[0]?.artistName ?? "Unknown Artist",
                artworkUrl: songs[0]?.artworkUrlLarge ?? songs[0]?.artworkUrl,
                topSongs: songs.slice(0, 10),
                albums: MOCK_ALBUMS.filter((album) => albumIds.has(album.id)),
            };
            return respond(artist);
        },
    };

    /** Null rather than a clamped value, so a stale index is a no-op. */
    function boundedQueueIndex(index: number): number | null {
        const target = Math.trunc(index);
        if (!Number.isFinite(target)) return null;
        return target >= 0 && target < queue.length ? target : null;
    }
}
