import {
    AuthStatus,
    type AppleMusicSubscription,
    type AuthResult,
} from "./AppleMusicKit.types";

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

    /**
     * A new music-user token without any prompt, for access the user already
     * granted. Resolves a non-authorized status instead when that is not
     * possible: access not granted, or Android, where a token always needs the
     * Apple Music app's own screen.
     */
    refreshUserToken: async (developerToken: string): Promise<AuthResult> => {
        if (!native) return { status: AuthStatus.Unknown };
        return normalizeAuthResult(
            await native.refreshUserToken(developerToken),
        );
    },

    /**
     * Whether the connected account can play full songs. `undefined` when the
     * platform cannot say (Android, Expo Go).
     */
    getSubscription: async (): Promise<AppleMusicSubscription> => {
        if (!native) return {};
        return native.getSubscription();
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
    refreshUserToken(developerToken: string): Promise<AuthResult>;
    getSubscription(): Promise<AppleMusicSubscription>;
    setTokens(developerToken: string, userToken: string | null): Promise<void>;
}

let native: AuthNativeModule | null = null;

function normalizeAuthResult(result: AuthResult): AuthResult {
    if (Object.values(AuthStatus).includes(result.status)) return result;
    return {
        status: AuthStatus.Failed,
        error:
            result.error ?? `Unexpected authorization status: ${result.status}`,
    };
}
