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
