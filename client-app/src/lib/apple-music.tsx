import { Auth, AuthStatus, type AuthResult } from "@apple-musickit";
import * as SecureStore from "expo-secure-store";
import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    type ReactNode,
} from "react";

type AppleMusicContextType = {
    authResult: AuthResult | null;
    isInitializing: boolean;
    isConnected: boolean;
    hasUserToken: boolean;
    ensureConnected: () => Promise<AuthResult | null>;
    connect: () => Promise<AuthResult | null>;
    disconnect: () => Promise<void>;
};

const AppleMusicContext = createContext<AppleMusicContextType | null>(null);

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

    const hasUserToken = Boolean(authResult?.userToken);
    const isConnected =
        authResult?.status === AuthStatus.Authorized && hasUserToken;

    const restoreNativeTokens = useCallback(async (result: AuthResult | null) => {
        const developerToken = getDeveloperToken();
        if (result?.status === AuthStatus.Authorized && result.userToken) {
            await Auth.setTokens(developerToken, result.userToken);
            return;
        }

        await Auth.setTokens(developerToken, null);
    }, []);

    // Initialize tokens on app load
    useEffect(() => {
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
                console.error("Failed to restore Apple Music tokens:", e);
                await clearStoredAuth();
                setAuthResult(null);
            } finally {
                setIsInitializing(false);
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
        try {
            const result = await Auth.authorize(getDeveloperToken());

            if (result.status === AuthStatus.Authorized && result.userToken) {
                await writeStoredAuth(result);
                await restoreNativeTokens(result);
            } else {
                await clearStoredAuth();
                await restoreNativeTokens(null);
            }
            setAuthResult(result);
            return result;
        } catch (error) {
            console.error("Apple Music authorization error:", error);
            throw error;
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
        setAuthResult(null);
        await clearStoredAuth();

        // Explicitly pass null to overwrite the userToken in the native module
        await restoreNativeTokens(null);
    }

    return (
        <AppleMusicContext.Provider
            value={{
                authResult,
                isInitializing,
                isConnected,
                hasUserToken,
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
    return JSON.parse(serialized) as AuthResult;
}

async function writeStoredAuth(result: AuthResult): Promise<void> {
    if (!(await SecureStore.isAvailableAsync())) return;
    await SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(result));
}

async function clearStoredAuth(): Promise<void> {
    if (!(await SecureStore.isAvailableAsync())) return;
    await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY);
}
