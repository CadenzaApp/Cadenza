import { useEffect, useRef, useState } from "react";

import { shareableSongId } from "@/lib/now-playing-change";
import { usePlaybackTrackState } from "@/lib/playback";
import {
    useMyLiveSession,
    useStartLiveSession,
} from "@/lib/routes/live-sessions";
import { usePrivacySettings } from "@/lib/routes/privacy";
import { useProfile } from "@/lib/routes/profile";
import { useMusicAccess } from "@/lib/use-music-access";

import { shouldOpenListenAlong } from "./listen-along";
import { useSeedSession } from "./use-seed-session";

/**
 * Listen along: with it on, playing music opens a listener only live
 * session, open to whoever the user's `session_join` audience allows, seeded
 * with what is playing. From there it is a normal session the user hosts,
 * which ends after 30 minutes without music like any other.
 *
 * Renders nothing. Mounted once, inside `PlaybackProvider`.
 */
export function ListenAlongRunner() {
    const canPlay = useMusicAccess().can("fullPlayback");
    const { privacy } = usePrivacySettings();
    const { mySessionId, mySessionLoading } = useMyLiveSession();
    const { activeTrack, isPlaying } = usePlaybackTrackState();
    const { profile } = useProfile();
    const { startLiveSession } = useStartLiveSession();
    const seedSession = useSeedSession();

    const songId = activeTrack ? shareableSongId(activeTrack) : null;
    const [openedFor, setOpenedFor] = useState<string | null>(null);
    const opening = useRef(false);

    const open = shouldOpenListenAlong({
        enabled: privacy.listen_along,
        canPlay,
        inSession: mySessionLoading ? null : mySessionId !== null,
        isPlaying,
        songId,
        openedFor,
    });

    useEffect(() => {
        if (!open || opening.current) return;
        opening.current = true;
        void (async () => {
            setOpenedFor(songId);
            try {
                const { session_id } = await startLiveSession({
                    name: profile?.username
                        ? `Listening with ${profile.username}`
                        : "Listening along",
                    default_role: "listener",
                    allow_join_without_code: true,
                });
                await seedSession(session_id);
            } catch (error) {
                // the next song tries again
                console.warn("Could not open a listen along session:", error);
            } finally {
                opening.current = false;
            }
        })();
    }, [open, profile?.username, seedSession, songId, startLiveSession]);

    return null;
}
