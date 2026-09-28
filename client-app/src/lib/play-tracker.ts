/**
 * What counts as a play. Pure and import-free, so it runs under `node --test`
 * (see `play-tracker.test.ts`). `play-recorder.ts` feeds it playback samples
 * and reports each play it finds to the backend.
 *
 * A listen counts once it has played for `PLAY_THRESHOLD_SECONDS`. A song
 * shorter than that has to be played to the end. Each listen counts once. A
 * new listen starts when the song changes, or when the same song jumps back to
 * its start, which is what repeat-one and skipping back look like.
 */

/** Played this long and it counts, unless the song is shorter than this. */
export const PLAY_THRESHOLD_SECONDS = 15;

/**
 * How close to the end counts as the end, for a song shorter than
 * `PLAY_THRESHOLD_SECONDS`. Playback is sampled every 750ms, and the last
 * sample before the next song starts can land up to that far short of the end.
 */
const END_TOLERANCE_SECONDS = 1;

/** A jump back to within this many seconds of the start is a new listen. */
const RESTART_WINDOW_SECONDS = 5;

export type PlayTrackerState = {
    /** The song being listened to, keyed the way the backend keys tags. */
    songId: string | null;
    /** Whether this listen was already counted. */
    counted: boolean;
    /** Progress at the previous sample, in seconds. */
    lastProgress: number;
};

export const INITIAL_PLAY_TRACKER_STATE: PlayTrackerState = {
    songId: null,
    counted: false,
    lastProgress: 0,
};

export type PlaySample = {
    songId: string | null;
    isPlaying: boolean;
    /** Seconds into the song. */
    progress: number;
    /** Length of the song in seconds, when known. */
    duration?: number;
};

/**
 * How many seconds of a song make a play: `PLAY_THRESHOLD_SECONDS`, or the
 * whole song, give or take `END_TOLERANCE_SECONDS`, when it is shorter than
 * that. An unknown length gets the full threshold.
 */
export function playThreshold(duration?: number): number {
    if (duration == null || !Number.isFinite(duration) || duration <= 0) {
        return PLAY_THRESHOLD_SECONDS;
    }
    if (duration >= PLAY_THRESHOLD_SECONDS) return PLAY_THRESHOLD_SECONDS;
    return Math.max(0, duration - END_TOLERANCE_SECONDS);
}

/**
 * Folds one playback sample into the state. `countedSongId` is the song that
 * this sample completed a play of, or null.
 */
export function trackPlay(
    state: PlayTrackerState,
    sample: PlaySample,
): { state: PlayTrackerState; countedSongId: string | null } {
    const progress = Number.isFinite(sample.progress) ? sample.progress : 0;
    const restarted =
        sample.songId === state.songId &&
        progress < RESTART_WINDOW_SECONDS &&
        state.lastProgress - progress > RESTART_WINDOW_SECONDS;
    const newListen = sample.songId !== state.songId || restarted;
    const alreadyCounted = newListen ? false : state.counted;

    const counts =
        sample.songId != null &&
        !alreadyCounted &&
        sample.isPlaying &&
        progress >= playThreshold(sample.duration);

    return {
        state: {
            songId: sample.songId,
            counted: alreadyCounted || counts,
            lastProgress: progress,
        },
        countedSongId: counts ? sample.songId : null,
    };
}
