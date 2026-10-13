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
