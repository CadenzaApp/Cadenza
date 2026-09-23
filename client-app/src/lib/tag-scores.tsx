import { useCallback, useEffect, useRef } from "react";

import { usePlaybackTrackState } from "./playback";
import type { QueryJSON } from "./query-json";
import { useDefaultTagsOnSong, useTagsOnSong } from "./routes/songs";
import { useEditTagScores } from "./routes/tags";
import { playTagScoreDeltas, queryTagScoreDeltas } from "./tag-score-deltas";
import type { Tag } from "./types";

/**
 * Scores the tags on a song as soon as that song starts playing, so the backend
 * learns which tags the user actually listens to: `LOCAL_TAG_PLAY_SCORE_DELTA`
 * for each of the user's own tags, and `DEFAULT_TAG_PLAY_SCORE_DELTA` for each
 * default tag. It renders nothing.
 *
 * There is no native playback-start event, so a start is read off the snapshot
 * `PlaybackProvider` polls: the active track is playing and is not the track the
 * last point went to. Resuming after a pause is therefore not a new play, and
 * neither is the same song repeating.
 *
 * Reading a song's default tags generates them if nothing has yet, so playing
 * a song no list has shown can spend an LLM call. A song played from a list
 * usually has them already, since the list rows read them. If the default read
 * fails, the play still scores the user's own tags.
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
    const { defaultTagsOnSong, defaultTagsOnSongErr } =
        useDefaultTagsOnSong(songId);
    const { editTagScores } = useEditTagScores();
    const scoredTrackIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!activeTrackId || !isPlaying) return;
        if (scoredTrackIdRef.current === activeTrackId) return;
        // the song's tags are still on their way, or there is no account to read
        // them with. either way the point waits for them rather than being lost
        if (!tagsOnSong) return;
        if (!defaultTagsOnSong && !defaultTagsOnSongErr) return;

        scoredTrackIdRef.current = activeTrackId;
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
        isPlaying,
        tagsOnSong,
    ]);

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
