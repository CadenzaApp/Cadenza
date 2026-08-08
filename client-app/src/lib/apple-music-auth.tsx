import { Auth, AuthStatus, type AuthResult } from "@apple-musickit";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    type ReactNode,
} from "react";

// Moved the developer token here so it's managed in one place
const DEVELOPER_TOKEN =
    "eyJhbGciOiJFUzI1NiIsImtpZCI6IjRMN0hSOTVVRFYifQ.eyJpc3MiOiJaVUgyRlg3OTNDIiwiaWF0IjoxNzc2MTIxMzU1LCJleHAiOjE3OTE4NDYxNTV9.HCcvJ-iHzFBTPP2R1w3-fC1NGLHxzBp2avq2FvwOkK8vqB_bo2Qhs6WthS84EVtGhsstJDJw_CHNGwPQEEIXMA";

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
        if (result?.status === AuthStatus.Authorized && result.userToken) {
            await Auth.setTokens(DEVELOPER_TOKEN, result.userToken);
            return;
        }

        await Auth.setTokens(DEVELOPER_TOKEN, null);
    }, []);

    // Initialize tokens on app load
    useEffect(() => {
        async function initAppleMusic() {
            try {
                const savedStr = await AsyncStorage.getItem("appleMusicAuth");
                if (savedStr) {
                    const savedAuth: AuthResult = JSON.parse(savedStr);
                    if (
                        savedAuth.status === AuthStatus.Authorized &&
                        savedAuth.userToken
                    ) {
                        await restoreNativeTokens(savedAuth);
                        setAuthResult(savedAuth);
                    } else {
                        await AsyncStorage.removeItem("appleMusicAuth");
                        await restoreNativeTokens(null);
                        setAuthResult(null);
                    }
                } else {
                    await restoreNativeTokens(null);
                    setAuthResult(null);
                }
            } catch (e) {
                console.error("Failed to restore Apple Music tokens:", e);
                await AsyncStorage.removeItem("appleMusicAuth");
                await restoreNativeTokens(null);
                setAuthResult(null);
            } finally {
                setIsInitializing(false);
            }
        }
        // required to make this inline function to handle async stuff. Unless there's a better way, idk.
        initAppleMusic();
    }, [restoreNativeTokens]);

    /**
     * Prompts the user to authorize Apple Music and stores the tokens in AsyncStorage,
     * allowing them to be restored in future sessions.
     */
    const connect = useCallback(async () => {
        try {
            const result = await Auth.authorize(DEVELOPER_TOKEN);

            if (result.status === AuthStatus.Authorized && result.userToken) {
                await AsyncStorage.setItem(
                    "appleMusicAuth",
                    JSON.stringify(result),
                );
                await restoreNativeTokens(result);
            } else {
                await AsyncStorage.removeItem("appleMusicAuth");
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
     * Signs the user out of Apple Music and invalidates the tokens in AsyncStorage.
     */
    async function disconnect() {
        setAuthResult(null);
        await AsyncStorage.removeItem("appleMusicAuth");

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
