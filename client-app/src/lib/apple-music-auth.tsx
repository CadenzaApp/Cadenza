import { Auth, AuthStatus, type AuthResult } from "@apple-musickit";
import * as SecureStore from "expo-secure-store";
import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useRef,
    type ReactNode,
} from "react";
import {
    parseStoredAppleMusicAuth,
    serializeAppleMusicAuth,
    shouldTrySilentRefresh,
    AppleMusicAuthGeneration,
} from "./apple-music-auth-state";
import { logHandledError } from "./log";

type AppleMusicContextType = {
    authResult: AuthResult | null;
    isInitializing: boolean;
    isConnected: boolean;
    /**
     * Catalog reads (search, song info, artists, catalog albums) work: they
     * need only Cadenza's developer token, so this is true once the stored
     * tokens are restored, connected or not.
     */
    canReadCatalog: boolean;
    hasUserToken: boolean;
    /** Non-secret cache namespace that changes whenever MusicKit auth changes. */
    sessionRevision: number;
    /**
     * Bumped by `refreshLibrary()`. Library reads revalidate in place when it
     * changes, keeping the pages they have. Not part of any cache key.
     */
    libraryRevision: number;
    /** Refetches every mounted library read in place. */
    refreshLibrary: () => void;
    /**
     * Apple rejected the stored music-user token, so reads keep failing until
     * the user reconnects. Distinct from `!isConnected`, which also covers
     * never having connected at all.
     */
    sessionExpired: boolean;
    ensureConnected: () => Promise<AuthResult | null>;
    connect: () => Promise<AuthResult | null>;
    disconnect: () => Promise<void>;
};

const AppleMusicContext = createContext<AppleMusicContextType | null>(null);

/**
 * Set by the provider on mount. A module-level hook rather than context because
 * the caller is an SWR fetcher, which runs outside React and cannot read one.
 * The provider is a singleton, so there is only ever one of these.
 */
let authFailureHandler: (() => void) | null = null;
const authGeneration = new AppleMusicAuthGeneration();
let pendingAuthReset: Promise<void> = Promise.resolve();
/** When the last silent token refresh ran, for its cooldown. */
let lastSilentRefreshAt: number | null = null;

/** Capture this before an Apple Music read so a later failure cannot clear a new session. */
export function getAppleMusicAuthGeneration(): number {
    return authGeneration.snapshot();
}

/**
 * Called when Apple has rejected a request with the current credentials and a
 * retry did not help. Tries a new token silently first; if that cannot work,
 * clears the credentials and offers a reconnect.
 */
export function reportAppleMusicAuthFailure(readGeneration: number) {
    if (
        !authFailureHandler ||
        !authGeneration.retireIfCurrent(readGeneration)
    ) {
        return;
    }
    authFailureHandler();
}

export function useAppleMusic() {
    const context = useContext(AppleMusicContext);
    if (!context) {
        throw new Error(
            "useAppleMusic must be used within an AppleMusicProvider",
        );
    }
    return context;
}

export function AppleMusicProvider({ children }: { children: ReactNode }) {
    const [authResult, setAuthResult] = useState<AuthResult | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);
    const [sessionRevision, setSessionRevision] = useState(0);
    const [libraryRevision, setLibraryRevision] = useState(0);
    const [sessionExpired, setSessionExpired] = useState(false);

    const refreshLibrary = useCallback(() => {
        setLibraryRevision((revision) => revision + 1);
    }, []);

    const hasUserToken = Boolean(authResult?.userToken);
    const isConnected =
        authResult?.status === AuthStatus.Authorized && hasUserToken;

    const restoreNativeTokens = useCallback(
        async (result: AuthResult | null) => {
            const developerToken = getDeveloperToken();
            if (result?.status === AuthStatus.Authorized && result.userToken) {
                await Auth.setTokens(developerToken, result.userToken);
                return;
            }

            await Auth.setTokens(developerToken, null);
        },
        [],
    );

    // Initialize tokens on app load
    useEffect(() => {
        authGeneration.beginTransition();
        async function initAppleMusic() {
            try {
                const savedAuth = await readStoredAuth();
                if (savedAuth) {
                    if (
                        savedAuth.status === AuthStatus.Authorized &&
                        savedAuth.userToken
                    ) {
                        await restoreNativeTokens(savedAuth);
                        setAuthResult(savedAuth);
                        setSessionRevision((revision) => revision + 1);
                    } else {
                        await clearStoredAuth();
                        await restoreNativeTokens(null);
                        setAuthResult(null);
                    }
                } else {
                    await restoreNativeTokens(null);
                    setAuthResult(null);
                }
            } catch (e) {
                logHandledError("Failed to restore Apple Music tokens", e);
                await clearStoredAuth();
                setAuthResult(null);
            } finally {
                setIsInitializing(false);
                authGeneration.endTransition();
            }
        }
        // required to make this inline function to handle async stuff. Unless there's a better way, idk.
        initAppleMusic();
    }, [restoreNativeTokens]);

    /**
     * Prompts the user to authorize Apple Music and stores the result securely,
     * allowing them to be restored in future sessions.
     */
    const connect = useCallback(async () => {
        authGeneration.beginTransition();
        try {
            await pendingAuthReset;
            const result = await Auth.authorize(getDeveloperToken());

            if (result.status === AuthStatus.Authorized && result.userToken) {
                await writeStoredAuth(result);
                await restoreNativeTokens(result);
            } else {
                await clearStoredAuth();
                await restoreNativeTokens(null);
            }
            setAuthResult(result);
            setSessionRevision((revision) => revision + 1);
            // only Apple rejecting a saved token expires a session. a cancel
            // or a denial leaves it as it was: a new user is not "expired",
            // and an expired one still is
            if (result.status === AuthStatus.Authorized && result.userToken) {
                setSessionExpired(false);
            }
            return result;
        } catch (error) {
            logHandledError("Apple Music authorization error", error);
            throw error;
        } finally {
            authGeneration.endTransition();
        }
    }, [restoreNativeTokens]);

    const ensureConnected = useCallback(async () => {
        if (
            authResult?.status === AuthStatus.Authorized &&
            authResult.userToken
        ) {
            await restoreNativeTokens(authResult);
            return authResult;
        }

        return connect();
    }, [authResult, connect, restoreNativeTokens]);

    /**
     * Signs the user out of Apple Music and removes the securely stored token.
     */
    async function disconnect() {
        authGeneration.beginTransition();
        try {
            setAuthResult(null);
            setSessionRevision((revision) => revision + 1);
            setSessionExpired(false);
            await clearStoredAuth();

            // Explicitly pass null to overwrite the userToken in the native module
            await restoreNativeTokens(null);
        } finally {
            authGeneration.endTransition();
        }
    }

    // the failure handler outlives renders, so it reads the session from here
    const authResultRef = useRef(authResult);
    useEffect(() => {
        authResultRef.current = authResult;
    }, [authResult]);

    // A token Apple has rejected is first replaced silently, which on iOS
    // needs no prompt once access is granted. Only when that cannot work is it
    // dropped. Keeping a dead token would mean every later read replays a
    // credential already known to be dead, which is what left the library
    // showing a raw 403 until the app was reinstalled.
    useEffect(() => {
        function expire() {
            setSessionExpired(true);
            setAuthResult(null);
            setSessionRevision((revision) => revision + 1);
            const clearStored = clearStoredAuth().catch((error) =>
                logHandledError("Failed to clear Apple Music auth", error),
            );
            const clearNative = restoreNativeTokens(null).catch((error) =>
                logHandledError(
                    "Failed to clear native Apple Music token",
                    error,
                ),
            );
            return Promise.all([clearStored, clearNative]).then(
                () => undefined,
            );
        }

        /** Resolves whether a new token is now in place. */
        async function refreshSilently(): Promise<boolean> {
            lastSilentRefreshAt = Date.now();
            // reads failing while this runs cannot retire the session again
            authGeneration.beginTransition();
            try {
                const result = await Auth.refreshUserToken(getDeveloperToken());
                if (
                    result.status !== AuthStatus.Authorized ||
                    !result.userToken
                ) {
                    return false;
                }
                await writeStoredAuth(result);
                await restoreNativeTokens(result);
                setAuthResult(result);
                setSessionExpired(false);
                // new cache keys, so every read that failed runs again
                setSessionRevision((revision) => revision + 1);
                return true;
            } catch (error) {
                logHandledError("Silent Apple Music refresh failed", error);
                return false;
            } finally {
                authGeneration.endTransition();
            }
        }

        authFailureHandler = () => {
            const wasConnected = Boolean(authResultRef.current?.userToken);
            // nothing to reconnect: a read that needed the user's token ran
            // without one. it fails on its own, no prompt
            if (!wasConnected) return;
            const refresh = shouldTrySilentRefresh(
                wasConnected,
                lastSilentRefreshAt,
                Date.now(),
            );
            pendingAuthReset = (async () => {
                if (refresh && (await refreshSilently())) return;
                await expire();
            })();
        };
        return () => {
            authFailureHandler = null;
        };
    }, [restoreNativeTokens]);

    return (
        <AppleMusicContext.Provider
            value={{
                authResult,
                isInitializing,
                isConnected,
                canReadCatalog: !isInitializing,
                hasUserToken,
                sessionRevision,
                libraryRevision,
                refreshLibrary,
                sessionExpired,
                ensureConnected,
                connect,
                disconnect,
            }}
        >
            {children}
        </AppleMusicContext.Provider>
    );
}

const AUTH_STORAGE_KEY = "appleMusicAuth";

function getDeveloperToken(): string {
    if (process.env.EXPO_PUBLIC_MOCK_MUSICKIT === "1") {
        return "mock-developer-token";
    }
    const token = process.env.EXPO_PUBLIC_MUSICKIT_DEVELOPER_TOKEN?.trim();
    if (!token) {
        throw new Error(
            "EXPO_PUBLIC_MUSICKIT_DEVELOPER_TOKEN is not configured.",
        );
    }
    return token;
}

async function readStoredAuth(): Promise<AuthResult | null> {
    if (!(await SecureStore.isAvailableAsync())) return null;
    const serialized = await SecureStore.getItemAsync(AUTH_STORAGE_KEY);
    if (!serialized) return null;
    // iOS Keychain data may survive uninstall/reinstall. A token acquired under
    // an older developer JWT must not silently become this build's session.
    const result = parseStoredAppleMusicAuth(serialized, getDeveloperToken());
    if (!result) {
        await clearStoredAuth();
        return null;
    }
    return result;
}

async function writeStoredAuth(result: AuthResult): Promise<void> {
    if (!(await SecureStore.isAvailableAsync())) return;
    await SecureStore.setItemAsync(
        AUTH_STORAGE_KEY,
        serializeAppleMusicAuth(result, getDeveloperToken()),
    );
}

async function clearStoredAuth(): Promise<void> {
    if (!(await SecureStore.isAvailableAsync())) return;
    await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY);
}
