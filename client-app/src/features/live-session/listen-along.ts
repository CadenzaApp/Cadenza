/** What listen along decides from. */
export type ListenAlongState = {
    /** The user turned listen along on. */
    enabled: boolean;
    /** Full playback; previews cannot host a session. */
    canPlay: boolean;
    /** Null while the caller's current session is still loading. */
    inSession: boolean | null;
    isPlaying: boolean;
    /** The playing song's catalog id, or null for a library only song. */
    songId: string | null;
    /** The song a session was last opened for. */
    openedFor: string | null;
};

/**
 * Whether listen along should open a session now: on, able to play, not in
 * one already, and playing a shareable song it has not opened one for. That
 * last part means ending a session stops it until the next song, rather than
 * opening a new one straight away.
 */
export function shouldOpenListenAlong(state: ListenAlongState): boolean {
    return (
        state.enabled &&
        state.canPlay &&
        state.inSession === false &&
        state.isPlaying &&
        state.songId !== null &&
        state.songId !== state.openedFor
    );
}
