import type { AuthResult } from "@apple-musickit";

type StoredAppleMusicAuth = {
    version: 2;
    developerToken: string;
    result: AuthResult;
};

/** A changed developer JWT requires a fresh user-token request. */
export function parseStoredAppleMusicAuth(
    serialized: string,
    developerToken: string,
): AuthResult | null {
    const stored = JSON.parse(serialized) as Partial<StoredAppleMusicAuth>;
    if (
        stored.version !== 2 ||
        stored.developerToken !== developerToken ||
        !stored.result
    )
        return null;
    return stored.result;
}

export function serializeAppleMusicAuth(
    result: AuthResult,
    developerToken: string,
): string {
    const stored: StoredAppleMusicAuth = {
        version: 2,
        developerToken,
        result,
    };
    return JSON.stringify(stored);
}

/** Prevents an old music read from retiring a newer authorization. */
export class AppleMusicAuthGeneration {
    private generation = 0;
    private transitions = 0;
    private retired = false;

    snapshot(): number {
        return this.generation;
    }

    beginTransition(): void {
        this.generation += 1;
        this.transitions += 1;
        this.retired = false;
    }

    endTransition(): void {
        this.transitions -= 1;
        this.generation += 1;
    }

    retireIfCurrent(snapshot: number): boolean {
        if (
            this.retired ||
            this.transitions > 0 ||
            snapshot !== this.generation
        ) {
            return false;
        }
        this.generation += 1;
        this.retired = true;
        return true;
    }
}

/**
 * At most one silent refresh this often. A token that is rejected again right
 * after a refresh means something a new token cannot fix, like a lapsed
 * subscription, and refreshing again would loop.
 */
export const SILENT_REFRESH_COOLDOWN_MS = 60_000;

/**
 * Whether a rejected music-user token should be replaced silently before
 * asking the user to reconnect. Only for a session that was connected, so a
 * disconnect the user chose is never undone behind their back.
 */
export function shouldTrySilentRefresh(
    wasConnected: boolean,
    lastRefreshAt: number | null,
    now: number,
): boolean {
    if (!wasConnected) return false;
    return (
        lastRefreshAt === null ||
        now - lastRefreshAt >= SILENT_REFRESH_COOLDOWN_MS
    );
}
