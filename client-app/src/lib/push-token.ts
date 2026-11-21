import { BACKEND_URL } from "./backend";
import { getAccessToken } from "./supabase";

/**
 * The Expo push token this phone last registered with the backend. Kept so
 * sign out can remove it before the session ends.
 */
let registered: string | null = null;

/**
 * Stores this phone's Expo push token for the signed-in user. The backend
 * moves a token another account had to this one.
 *
 * Not a hook, and does not import the API hooks: `AccountProvider` calls
 * {@link unregisterPushToken}, and importing them would make account, this
 * file, and the API layer a cycle.
 */
export async function registerPushToken(token: string): Promise<void> {
    await pushTokenRequest("POST", token);
    registered = token;
}

/**
 * Removes the token registered by {@link registerPushToken} from the backend,
 * so this phone stops getting the account's pushes. Call it before signing
 * out, while the access token still works. Never throws: a sign out that
 * cannot reach the backend still signs out, and the token then stays until
 * someone else signs in here or Expo reports it dead.
 */
export async function unregisterPushToken(): Promise<void> {
    const current = registered;
    if (!current) return;
    registered = null;
    try {
        await pushTokenRequest("DELETE", current);
    } catch (error) {
        console.warn("[push] Could not remove the push token:", error);
    }
}

async function pushTokenRequest(method: "POST" | "DELETE", token: string) {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error("not signed in");
    const resp = await fetch(`${BACKEND_URL}/push-tokens`, {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
    });
    if (!resp.ok) {
        throw new Error(
            `${method} /push-tokens failed with ${resp.status}: ${await resp.text()}`,
        );
    }
}
