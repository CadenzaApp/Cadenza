// Static fixtures shaped like the values AppleMusicKitNativeModule resolves
// with, for frontend work without a native build. Data only - nothing here is
// wired into the module yet.
//
// Shapes follow the native implementations:
//   - songDuration is in seconds, releaseDate in epoch milliseconds
//   - catalog songs use numeric ids, library songs are prefixed "i."
//   - album and playlist items carry only id/title/artistName/artworkUrl,
//     since that is all the native side sets on them
//
// Each list ends with a few deliberately awkward entries - emoji, missing and
// empty fields, text that will not fit - so layouts get stressed by default
// rather than only on the happy path.

import {
    AuthStatus,
    PlaybackQueueType,
    type AuthResult,
    type MusicItem,
} from "./AppleMusicKit.types";

/** Swap for real artwork urls once there is something to point at. */
function artwork(seed: string) {
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
        artworkUrl: artwork("after-hours"),
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
        artworkUrl: artwork("harrys-house"),
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
        artworkUrl: artwork("good-days"),
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
        artworkUrl: artwork("future-nostalgia"),
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
        artworkUrl: artwork("rumours"),
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
        artworkUrl: artwork("awaken-my-love"),
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
        artworkUrl: artwork("midnight-bloom"),
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
        artworkUrl: artwork("rtl-mixed"),
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
        artworkUrl: artwork("very-long-title"),
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
        artworkUrl: artwork("to-pimp-a-butterfly"),
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
        artworkUrl: artwork("in-rainbows"),
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
        artworkUrl: artwork("stranger-in-the-alps"),
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
        artworkUrl: artwork("immunity"),
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
        artworkUrl: artwork("our-hope"),
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
        artworkUrl: artwork("more-life"),
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
        artworkUrl: artwork("hidden-track"),
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
        artworkUrl: artwork("pre-release"),
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
        artworkUrl: artwork("after-hours"),
    },
    {
        id: "1615584999",
        title: "Harry's House",
        artistName: "Harry Styles",
        artworkUrl: artwork("harrys-house"),
    },
    {
        id: "1497787091",
        title: "Future Nostalgia",
        artistName: "Dua Lipa",
        artworkUrl: artwork("future-nostalgia"),
    },
    {
        id: "1440833080",
        title: "Rumours",
        artistName: "Fleetwood Mac",
        artworkUrl: artwork("rumours"),
    },
    {
        id: "1700000000",
        title: "🌙🌙🌙",
        artistName: "🦋 lilac ✨",
        artworkUrl: artwork("midnight-bloom"),
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
        artworkUrl: artwork("late-night-drive"),
    },
    {
        id: "p.O1kz9WMuqNJb3Xd",
        title: "Focus Flow",
        artistName: "Apple Music",
        artworkUrl: artwork("focus-flow"),
    },
    {
        id: "p.8aVBmZ3TqLdW1Kx",
        title: "songs i cry to 😭😭😭 (do not open) 🔒",
        artistName: "Troy",
        artworkUrl: artwork("cry-playlist"),
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
