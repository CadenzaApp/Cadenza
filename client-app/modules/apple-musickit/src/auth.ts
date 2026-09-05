import { AuthStatus, type AuthResult } from "./AppleMusicKit.types";

/** Apple Music authorization and token-management operations. */
export const Auth = {
    /** Returns whether the native Apple Music bridge is installed. */
    isAvailable: (): boolean => native !== null,

    /** Prompts the user to authorize Apple Music with the supplied developer token. */
    authorize: async (developerToken: string): Promise<AuthResult> => {
        if (!native) {
            console.warn("Apple Music API is not available in Expo Go.");
            return {
                status: AuthStatus.Unknown,
                error: "Apple Music API is not available in Expo Go. Test on an android emulator or physical device (physical device required for audio playback.)",
            };
        }
        return normalizeAuthResult(await native.authorize(developerToken));
    },

    /** Sets the tokens used by native Apple Music requests, or clears the user token. */
    setTokens: async (
        developerToken: string,
        userToken?: string | null,
    ): Promise<void> => {
        if (!native) return;
        return native.setTokens(developerToken, userToken ?? null);
    },
};

/** @internal Supplies the native authorization implementation. */
export function configureAuthNative(
    nativeModule: AuthNativeModule | null,
): void {
    native = nativeModule;
}

interface AuthNativeModule {
    authorize(developerToken: string): Promise<AuthResult>;
    setTokens(developerToken: string, userToken: string | null): Promise<void>;
}

let native: AuthNativeModule | null = null;

function normalizeAuthResult(result: AuthResult): AuthResult {
    if (Object.values(AuthStatus).includes(result.status)) return result;
    return {
        status: AuthStatus.Failed,
        error: result.error ?? `Unexpected authorization status: ${result.status}`,
    };
}
