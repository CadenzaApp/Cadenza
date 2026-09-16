import { MusicKit, type MusicItem } from "@apple-musickit";
import { Share } from "react-native";

/**
 * Shares a song's canonical Apple Music link. Falls back to a fresh catalog
 * lookup when the item in hand does not already carry one (a library-only
 * fetch does not always include `shareUrl`).
 */
export async function shareTrack(track: MusicItem): Promise<void> {
    try {
        let appleMusicUrl = track.shareUrl;
        if (!appleMusicUrl) {
            const [resolvedTrack] = await MusicKit.getSongInfo([track.id]);
            appleMusicUrl = resolvedTrack?.shareUrl;
        }
        if (!appleMusicUrl) {
            throw new Error("No canonical Apple Music URL is available.");
        }

        await Share.share({
            title: track.title,
            // Android ignores the separate `url` field, so include the
            // canonical link in the message on every platform.
            message: `I'm listening to ${track.title} by ${track.artistName || "an unknown artist"}. ${appleMusicUrl}`,
            url: appleMusicUrl,
        });
    } catch (error) {
        console.error("Failed to share the track:", error);
    }
}

/** Shares an album or playlist's canonical Apple Music link. */
export async function shareCollection(collection: MusicItem): Promise<void> {
    const appleMusicUrl = collection.shareUrl;
    if (!appleMusicUrl) {
        console.error("No canonical Apple Music URL is available to share.");
        return;
    }

    try {
        await Share.share({
            title: collection.title,
            message: `Check out ${collection.title}${collection.artistName ? ` by ${collection.artistName}` : ""}. ${appleMusicUrl}`,
            url: appleMusicUrl,
        });
    } catch (error) {
        console.error("Failed to share the collection:", error);
    }
}
