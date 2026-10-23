import {
    SettingsPoints,
    SettingsSheet,
    type SettingsPoint,
} from "./settings-ui";

/**
 * What Apple lets other apps do with Apple Music, and so what Cadenza cannot.
 * Each point is a limit of Apple's MusicKit and Apple Music API, not a choice.
 */
const LIMITS: SettingsPoint[] = [
    {
        icon: "remove-circle-outline",
        title: "Removing songs",
        body: "Apple lets apps add songs to your library and playlists, but not take them out. Remove a song, or delete a playlist, in the Music app.",
    },
    {
        icon: "swap-vertical-outline",
        title: "Reordering playlists",
        body: "Cadenza can add songs to the end of a playlist and make new playlists. Moving songs around inside one has to happen in the Music app.",
    },
    {
        icon: "time-outline",
        title: "Listening history",
        body: "Apple only shares your last few dozen plays, with no times. Analytics only counts what you play in Cadenza, from the day you start.",
    },
    {
        icon: "sync-outline",
        title: "Changes made in Music",
        body: "Songs you add or remove in the Music app show up in Cadenza after a sync. Sync now on the Apple Music card runs one right away.",
    },
    {
        icon: "play-circle-outline",
        title: "Full songs need a subscription",
        body: "Playing whole songs needs an active Apple Music subscription. Without one, Apple only allows short previews.",
    },
    {
        icon: "document-text-outline",
        title: "Lyrics and song details",
        body: "Apple does not share lyrics with other apps. Titles, artists, genres, and artwork come from Apple and cannot be edited in Cadenza.",
    },
    {
        icon: "person-circle-outline",
        title: "Your Apple account",
        body: "Apple does not tell apps your Apple ID name or email, which is why Cadenza has its own username.",
    },
    {
        icon: "logo-android",
        title: "Android",
        body: "On Android, signing in to Apple Music needs the Apple Music app installed.",
    },
];

/** What Cadenza cannot do with Apple Music, and why. Read only. */
export function AppleMusicLimitsScreen() {
    return (
        <SettingsSheet title="Apple Music limits">
            <SettingsPoints points={LIMITS} />
        </SettingsSheet>
    );
}
