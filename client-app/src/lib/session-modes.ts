/**
 * Shuffle and repeat a caller just set in a live session, shown over the
 * cached snapshot until the server's answer lands. A second tap before the
 * first answers keeps showing, so the pill does not flick back in between.
 * A failed command drops its value at once, so the pill goes back.
 */
import type { LiveSessionPlayback } from "./routes/live-sessions";

export type SessionModes = Pick<LiveSessionPlayback, "shuffle" | "repeat_mode">;
type Mode = keyof SessionModes;

/** By session: each mode in flight and the tap that set it. */
type Pending = {
    [K in Mode]?: { value: SessionModes[K]; tap: number };
};

const pending = new Map<string, Pending>();
const listeners = new Set<() => void>();
let taps = 0;

function notify() {
    for (const listener of listeners) listener();
}

/**
 * Shows `modes` for session `id` until the returned release is called. A
 * later hold on the same mode wins, and an earlier release leaves it alone.
 */
export function holdSessionModes(id: string, modes: Partial<SessionModes>) {
    const tap = ++taps;
    const next: Pending = { ...pending.get(id) };
    if (modes.shuffle !== undefined) {
        next.shuffle = { value: modes.shuffle, tap };
    }
    if (modes.repeat_mode !== undefined) {
        next.repeat_mode = { value: modes.repeat_mode, tap };
    }
    const held = Object.keys(modes) as Mode[];
    pending.set(id, next);
    notify();
    return function release() {
        const now = pending.get(id);
        const mine = held.filter((mode) => now?.[mode]?.tap === tap);
        if (!now || mine.length === 0) return;
        const left: Pending = { ...now };
        for (const mode of mine) delete left[mode];
        if (Object.keys(left).length === 0) pending.delete(id);
        else pending.set(id, left);
        notify();
    };
}

/** The modes session `id` has in flight. Stable until one changes. */
export function pendingSessionModes(id: string): Pending | undefined {
    return pending.get(id);
}

export function subscribeSessionModes(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** `playback` with the modes in flight shown over it. */
export function withPendingModes(
    playback: LiveSessionPlayback,
    modes: Pending | undefined,
): LiveSessionPlayback {
    if (!modes) return playback;
    return {
        ...playback,
        ...(modes.shuffle && { shuffle: modes.shuffle.value }),
        ...(modes.repeat_mode && { repeat_mode: modes.repeat_mode.value }),
    };
}
