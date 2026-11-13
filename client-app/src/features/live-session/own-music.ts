/**
 * Set when the caller leaves a live session to play their own music, so the
 * session player does not put their old queue back over it, which it does
 * for a member who simply leaves. Only good for a few seconds, the time
 * leaving takes to land, so a stale one cannot skip a later restore.
 */
const GOOD_FOR_MS = 15_000;

let leftForOwnMusicAt: number | null = null;

export function markLeavingForOwnMusic() {
    leftForOwnMusicAt = Date.now();
}

export function clearLeavingForOwnMusic() {
    leftForOwnMusicAt = null;
}

/** True once, when the caller just left to play their own music. */
export function takeLeavingForOwnMusic() {
    const at = leftForOwnMusicAt;
    leftForOwnMusicAt = null;
    return at !== null && Date.now() - at < GOOD_FOR_MS;
}
