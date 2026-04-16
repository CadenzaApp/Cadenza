import { Auth, type AuthResult } from "@apple-musickit";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    createContext,
    useContext,
    useState,
    useEffect,
    type ReactNode,
} from "react";

// Moved the developer token here so it's managed in one place
const DEVELOPER_TOKEN =
    "eyJhbGciOiJFUzI1NiIsImtpZCI6IjRMN0hSOTVVRFYifQ.eyJpc3MiOiJaVUgyRlg3OTNDIiwiaWF0IjoxNzc2MTIxMzU1LCJleHAiOjE3OTE4NDYxNTV9.HCcvJ-iHzFBTPP2R1w3-fC1NGLHxzBp2avq2FvwOkK8vqB_bo2Qhs6WthS84EVtGhsstJDJw_CHNGwPQEEIXMA";

type AppleMusicContextType = {
    authResult: AuthResult | null;
    isInitializing: boolean;
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

    // 1. Initialize tokens on app load (Single Source of Truth)
    useEffect(() => {
        async function initAppleMusic() {
            try {
                const savedStr = await AsyncStorage.getItem("appleMusicAuth");
                if (savedStr) {
                    const savedAuth: AuthResult = JSON.parse(savedStr);
                    setAuthResult(savedAuth);
                    await Auth.setTokens(DEVELOPER_TOKEN, savedAuth.userToken);
                } else {
                    await Auth.setTokens(DEVELOPER_TOKEN);
                }
            } catch (e) {
                console.error("Failed to restore Apple Music tokens:", e);
            } finally {
                setIsInitializing(false);
            }
        }
        initAppleMusic();
    }, []);

    // 2. Connect logic
    async function connect() {
        try {
            const result = await Auth.authorize(DEVELOPER_TOKEN);
            setAuthResult(result);

            if (result.status === "authorized" && result.userToken) {
                await AsyncStorage.setItem(
                    "appleMusicAuth",
                    JSON.stringify(result),
                );
                await Auth.setTokens(DEVELOPER_TOKEN, result.userToken);
            }
            return result;
        } catch (error) {
            console.error("Apple Music authorization error:", error);
            throw error;
        }
    }

    // 3. Disconnect logic
    async function disconnect() {
        setAuthResult(null);
        await AsyncStorage.removeItem("appleMusicAuth");

        // Explicitly pass null to overwrite the userToken in the Android Native module
        await Auth.setTokens(DEVELOPER_TOKEN, null);
    }

    return (
        <AppleMusicContext.Provider
            value={{ authResult, isInitializing, connect, disconnect }}
        >
            {children}
        </AppleMusicContext.Provider>
    );
}
