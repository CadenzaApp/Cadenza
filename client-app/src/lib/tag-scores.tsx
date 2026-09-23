import { useCallback, useEffect, useRef } from "react";

import { usePlaybackTrackState } from "./playback";
import type { QueryJSON } from "./query-json";
import { useTagsOnSong } from "./routes/songs";
import { useEditTagScores } from "./routes/tags";
import { playTagScoreDeltas, queryTagScoreDeltas } from "./tag-score-deltas";
import type { Tag } from "./types";

/**
 * Gives every tag on a song a point as soon as that song starts playing, so the
 * backend learns which tags the user actually listens to. It renders nothing.
 *
 * There is no native playback-start event, so a start is read off the snapshot
 * `PlaybackProvider` polls: the active track is playing and is not the track the
 * last point went to. Resuming after a pause is therefore not a new play, and
 * neither is the same song repeating.
 *
 * Only the user's own tags on the song are scored. Suggested tags are left
 * alone on purpose, because reading them generates them, and starting a song
 * should never spend an LLM call.
 *
 * Mounted at the root under `PlaybackProvider`, which is itself under
 * `AccountProvider`. The tag read is dormant without an account, so a signed out
 * session scores nothing.
 */
export function TagScoreTracker() {
    const { activeTrack, activeTrackId, isPlaying } = usePlaybackTrackState();
    // the id a song crosses into the backend under, the same key the player
    // sheet and the list rows read a song's tags with, so this is usually warm
    const songId = activeTrack
        ? (activeTrack.catalogId ?? activeTrack.id)
        : undefined;
    const { tagsOnSong } = useTagsOnSong(songId);
    const { editTagScores } = useEditTagScores();
    const scoredTrackIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!activeTrackId || !isPlaying) return;
        if (scoredTrackIdRef.current === activeTrackId) return;
        // the song's tags are still on their way, or there is no account to read
        // them with. either way the point waits for them rather than being lost
        if (!tagsOnSong) return;

        scoredTrackIdRef.current = activeTrackId;
        const deltas = playTagScoreDeltas(tagsOnSong);
        if (Object.keys(deltas).length === 0) return;

        const scorePlay = async () => {
            try {
                await editTagScores(deltas);
            } catch (e) {
                // nothing in the app shows a score, so a lost point is not
                // worth interrupting playback over
                console.warn("Failed to score the tags on a played song:", e);
            }
        };

        void scorePlay();
    }, [activeTrackId, editTagScores, isPlaying, tagsOnSong]);

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
