import { useEffect, useRef, useState } from "react";

import { useAccount } from "./account";
import { playInterestScoreDeltas } from "./interest-score-deltas";
import { usePlaybackTrackState } from "./playback";
import { useEditInterestScores } from "./routes/social";

/** How long a song has to play, without a pause, before its play scores. */
const PLAY_SCORE_DELAY_MS = 5000;

/**
 * One play of a song: from the moment it becomes the active track until a
 * different song does. `listened` once it has played for `PLAY_SCORE_DELAY_MS`.
 */
type Play = { trackId: string; listened: boolean };

/**
 * Raises the user's interest in a song's artist and each of its genres once
 * it has played for `PLAY_SCORE_DELAY_MS`, from the track's Apple Music
 * metadata, in one `PATCH /social/interests/update`. That is what the social
 * feed ranks posts by. See `playInterestScoreDeltas`. It renders nothing.
 *
 * There is no native playback event, so plays are read off the snapshot
 * `PlaybackProvider` polls. A play starts when the active track becomes a
 * different song, and scores at most once. Resuming after a pause is therefore
 * not a new play, and neither is the same song repeating. The delay counts
 * uninterrupted playing time: pausing before it runs out starts it over, and
 * moving to another song drops the play.
 *
 * Mounted at the root under `PlaybackProvider`, which is itself under
 * `AccountProvider`. The interest update waits for an account, so a signed out
 * session scores nothing.
 */
export function InterestPlayTracker() {
    const { activeTrack, activeTrackId, isPlaying } = usePlaybackTrackState();
    const { account } = useAccount();
    const { editInterestScores } = useEditInterestScores();
    const [play, setPlay] = useState<Play | null>(null);
    const interestScoredPlayRef = useRef<Play | null>(null);

    // a different song is a new play. a missing track is ignored, so a snapshot
    // that briefly loses the track and finds the same one again does not start a
    // second play. set during render, so no effect ever sees the old play with
    // the new track
    if (activeTrackId && activeTrackId !== play?.trackId) {
        setPlay({ trackId: activeTrackId, listened: false });
    }

    // cleared on a pause or a track change, so only uninterrupted play counts
    useEffect(() => {
        if (!activeTrackId || !isPlaying) return;

        const timer = setTimeout(
            () =>
                setPlay((current) =>
                    current?.trackId === activeTrackId && !current.listened
                        ? { ...current, listened: true }
                        : current,
                ),
            PLAY_SCORE_DELAY_MS,
        );
        return () => clearTimeout(timer);
    }, [activeTrackId, isPlaying]);

    useEffect(() => {
        if (!play?.listened || play.trackId !== activeTrackId) return;
        if (interestScoredPlayRef.current === play) return;
        if (!account || !activeTrack) return;

        interestScoredPlayRef.current = play;
        const deltas = playInterestScoreDeltas(activeTrack);
        if (deltas.length === 0) return;

        (async () => {
            try {
                await editInterestScores({ delta_scores: deltas });
            } catch (e) {
                console.warn(
                    "Failed to score the interests in a played song:",
                    e,
                );
            }
        })();
    }, [account, activeTrack, activeTrackId, editInterestScores, play]);

    return null;
}
