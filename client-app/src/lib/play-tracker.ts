/**
 * What a listen is made of. Pure and import-free, so it runs under
 * `node --test` (see `play-tracker.test.ts`). `play-recorder.ts` feeds it
 * playback samples and ships the events it finds to the backend.
 *
 * Folds a stream of playback snapshots into listening events. One listen runs
 * from a song becoming active until a different one does, or until the same one
 * jumps back to its start, which is what repeat-one and skipping back look like.
 * Each listen emits:
 *
 * - `play_start` when it begins.
 * - `play_counted` once it has played for `PLAY_THRESHOLD_SECONDS`. A song
 *   shorter than that has to be played to the end. At most once per listen.
 * - exactly one of `play_complete` (reached the end) or `skip` (left early),
 *   when the listen ends. Both carry how long was actually spent playing, which
 *   is why listening time can be summed without double counting.
 * - `seek` when the user jumps backwards inside the song.
 *
 * Exactly one terminal event per listen is what the backend's skip rate and
 * listening time are built on, so nothing here synthesizes one early. A listen
 * interrupted by the app leaving the foreground keeps its state and ends
 * normally when sampling resumes; if the app is killed first, that listen keeps
 * its `play_counted` and loses only its terminal event. Emitting one on the way
 * out would double count the listens that do come back.
 */

/** Played this long and it counts, unless the song is shorter than this. */
export const PLAY_THRESHOLD_SECONDS = 15;

/**
 * How close to the end counts as the end, for a song shorter than
 * `PLAY_THRESHOLD_SECONDS`. Playback is sampled every 750ms, and the last
 * sample before the next song starts can land up to that far short of the end.
 */
const END_TOLERANCE_SECONDS = 1;

/**
 * How close to the end a listen has to get to be a completion rather than a
 * skip. Wider than `END_TOLERANCE_SECONDS` because the last sample of a song
 * can be a sampling interval short of the real end.
 */
const COMPLETE_TOLERANCE_SECONDS = 2;

/** A jump back to within this many seconds of the start is a new listen. */
const RESTART_WINDOW_SECONDS = 5;

/** A jump back by more than this, but not to the start, is a seek. */
const SEEK_BACK_SECONDS = 3;

/**
 * The most progress one sample may add to listened time. Sampling is every
 * 750ms, so anything larger is a seek or a gap where the app was not sampling,
 * and crediting it would invent listening time that did not happen.
 */
const MAX_CREDITED_STEP_SECONDS = 2;

export type TrackedEventType =
    | "play_start"
    | "play_counted"
    | "play_complete"
    | "skip"
    | "seek";

/** One thing that happened, ready for `play-recorder.ts` to send. */
export type TrackedEvent = {
    type: TrackedEventType;
    songId: string;
    /** Where in the song it happened, in seconds. */
    positionSeconds: number;
    /** The song's length, when known. */
    durationSeconds?: number;
    /**
     * Seconds of this listen actually spent playing, excluding pauses, seeks,
     * and any stretch where the app was not sampling. Only on `play_complete`
     * and `skip`, the two events that end a listen.
     */
    listenedSeconds?: number;
    /** Where the user jumped from. Only on `seek`. */
    fromSeconds?: number;
};

export type PlayTrackerState = {
    /** The song being listened to, keyed the way the backend keys tags. */
    songId: string | null;
    /** Whether this listen was already counted. */
    counted: boolean;
    /** Progress at the previous sample, in seconds. */
    lastProgress: number;
    /** Seconds of this listen spent playing so far. */
    listened: number;
    /** The song's length, carried so the event that ends the listen can report it. */
    duration?: number;
};

export const INITIAL_PLAY_TRACKER_STATE: PlayTrackerState = {
    songId: null,
    counted: false,
    lastProgress: 0,
    listened: 0,
    duration: undefined,
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

/** Whether a listen that stopped at `progress` had reached the song's end. */
function reachedTheEnd(progress: number, duration?: number): boolean {
    if (duration == null || !Number.isFinite(duration) || duration <= 0) {
        // without a length there is no end to have reached, so err towards skip
        return false;
    }
    return progress >= duration - COMPLETE_TOLERANCE_SECONDS;
}

/**
 * Folds one playback sample into the state, returning the events it produced.
 *
 * Events come back in the order they happened, so a sample that ends one listen
 * and starts another returns the terminal event before the new `play_start`.
 */
export function trackPlay(
    state: PlayTrackerState,
    sample: PlaySample,
): { state: PlayTrackerState; events: TrackedEvent[] } {
    const progress = Number.isFinite(sample.progress) ? sample.progress : 0;
    const sameSong = sample.songId === state.songId;
    const restarted =
        sameSong &&
        progress < RESTART_WINDOW_SECONDS &&
        state.lastProgress - progress > RESTART_WINDOW_SECONDS;
    const newListen = !sameSong || restarted;

    const events: TrackedEvent[] = [];

    if (newListen && state.songId != null) {
        // the listen that just ended finished one way or the other, never both
        const finished = reachedTheEnd(state.lastProgress, state.duration);
        events.push({
            type: finished ? "play_complete" : "skip",
            songId: state.songId,
            positionSeconds: state.lastProgress,
            durationSeconds: state.duration,
            listenedSeconds: state.listened,
        });
    }

    if (newListen && sample.songId != null) {
        events.push({
            type: "play_start",
            songId: sample.songId,
            positionSeconds: progress,
            durationSeconds: sample.duration,
        });
    }

    // a backward jump that is not a restart is the user moving the playhead.
    // forward jumps are left alone: the app stops sampling in the background, so
    // a big forward step is usually that and not a seek
    if (
        !newListen &&
        sample.songId != null &&
        state.lastProgress - progress > SEEK_BACK_SECONDS
    ) {
        events.push({
            type: "seek",
            songId: sample.songId,
            positionSeconds: progress,
            durationSeconds: sample.duration,
            fromSeconds: state.lastProgress,
        });
    }

    // only ordinary forward playback adds to listened time
    const step = progress - state.lastProgress;
    const credited =
        !newListen &&
        sample.isPlaying &&
        step > 0 &&
        step <= MAX_CREDITED_STEP_SECONDS
            ? step
            : 0;
    const listened = (newListen ? 0 : state.listened) + credited;

    const alreadyCounted = newListen ? false : state.counted;
    const counts =
        sample.songId != null &&
        !alreadyCounted &&
        sample.isPlaying &&
        progress >= playThreshold(sample.duration);

    if (counts && sample.songId != null) {
        events.push({
            type: "play_counted",
            songId: sample.songId,
            positionSeconds: progress,
            durationSeconds: sample.duration,
        });
    }

    return {
        state: {
            songId: sample.songId,
            counted: alreadyCounted || counts,
            lastProgress: progress,
            listened,
            duration:
                sample.duration ?? (newListen ? undefined : state.duration),
        },
        events,
    };
}
