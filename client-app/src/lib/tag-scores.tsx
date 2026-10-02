import { useCallback, useEffect, useRef, useState } from "react";

import { useAccount } from "./account";
import { playInterestScoreDeltas } from "./interest-score-deltas";
import { usePlaybackTrackState } from "./playback";
import type { QueryJSON } from "./query-json";
import { useEditInterestScores } from "./routes/social";
import { useDefaultTagsOnSong, useTagsOnSong } from "./routes/songs";
import { useEditTagScores } from "./routes/tags";
import { playTagScoreDeltas, queryTagScoreDeltas } from "./tag-score-deltas";
import type { Tag } from "./types";

/** How long a song has to play, without a pause, before its play scores. */
const PLAY_SCORE_DELAY_MS = 5000;

/**
 * One play of a song: from the moment it becomes the active track until a
 * different song does. `listened` once it has played for `PLAY_SCORE_DELAY_MS`.
 */
type Play = { trackId: string; listened: boolean };

/**
 * Scores the tags on a song once it has played for `PLAY_SCORE_DELAY_MS`, so the
 * backend learns which tags the user actually listens to rather than skips past:
 * `LOCAL_TAG_PLAY_SCORE_DELTA` for each of the user's own tags, and
 * `DEFAULT_TAG_PLAY_SCORE_DELTA` for each default tag. It renders nothing.
 *
 * There is no native playback event, so plays are read off the snapshot
 * `PlaybackProvider` polls. A play starts when the active track becomes a
 * different song, and scores at most once. Resuming after a pause is therefore
 * not a new play, and neither is the same song repeating. The delay counts
 * uninterrupted playing time: pausing before it runs out starts it over, and
 * moving to another song drops the play.
 *
 * A default tag that shares a name with one of the user's tags on the song
 * counts as the user's own, once.
 *
 * The same play also raises the user's interest in the song's artist and each
 * of its genres, from the track's Apple Music metadata, in one
 * `PATCH /social/interests/update`. That is what the social feed ranks posts
 * by. See `playInterestScoreDeltas`. It needs nothing but the track, so it does
 * not wait on the tag reads, and the two requests fail independently.
 *
 * Reading a song's default tags generates them if nothing has yet, so playing
 * a song no list has shown can spend an LLM call. A song played from a list
 * usually has them already, since the list rows read them. If the default read
 * fails, the play still scores the user's own tags.
 *
 * Mounted at the root under `PlaybackProvider`, which is itself under
 * `AccountProvider`. The tag read is dormant without an account, and the
 * interest update waits for one, so a signed out session scores nothing.
 */
export function TagScoreTracker() {
    const { activeTrack, activeTrackId, isPlaying } = usePlaybackTrackState();
    // the id a song crosses into the backend under, the same key the player
    // sheet and the list rows read a song's tags with, so this is usually warm
    const songId = activeTrack
        ? (activeTrack.catalogId ?? activeTrack.id)
        : undefined;
    const { tagsOnSong } = useTagsOnSong(songId);
    const { defaultTagsOnSong, defaultTagsOnSongErr } =
        useDefaultTagsOnSong(songId);
    const { editTagScores } = useEditTagScores();
    const { account } = useAccount();
    const { editInterestScores } = useEditInterestScores();
    const [play, setPlay] = useState<Play | null>(null);
    // the play that has scored. a play object is replaced only by a new play or
    // once when it becomes listened, so this cannot match a later play
    const scoredPlayRef = useRef<Play | null>(null);
    // the same, for the play's artist and genres
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
        if (scoredPlayRef.current === play) return;
        // the song's tags are still on their way, or there is no account to read
        // them with. either way the point waits for them rather than being lost
        if (!tagsOnSong) return;
        if (!defaultTagsOnSong && !defaultTagsOnSongErr) return;

        scoredPlayRef.current = play;
        const deltas = playTagScoreDeltas(tagsOnSong, defaultTagsOnSong ?? []);
        if (Object.keys(deltas).length === 0) return;

        editTagScores(deltas).catch((e) =>
            console.warn("Failed to score the tags on a played song:", e),
        );
    }, [
        activeTrackId,
        defaultTagsOnSong,
        defaultTagsOnSongErr,
        editTagScores,
        play,
        tagsOnSong,
    ]);

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

/**
 * Returns `scoreQueryTags(query, tags)`, which gives every tag `query` uses
 * positively `QUERY_TAG_SCORE_DELTA` points, in one `PATCH /tags/scores`.
 * `tags` resolves the query's tag ids to names; see `queryTagScoreDeltas`.
 *
 * Call it when the user commits to a query, not on every edit: the builders
 * run the query live as it changes, and each half built query is not a use.
 * A failure is logged and swallowed, like a lost play point.
 */
export function useScoreQueryTags() {
    const { editTagScores } = useEditTagScores();

    return useCallback(
        async (query: QueryJSON, tags: readonly Tag[]) => {
            const deltas = queryTagScoreDeltas(query, tags);
            if (Object.keys(deltas).length === 0) return;

            try {
                await editTagScores(deltas);
            } catch (e) {
                console.warn("Failed to score the tags in a query:", e);
            }
        },
        [editTagScores],
    );
}
