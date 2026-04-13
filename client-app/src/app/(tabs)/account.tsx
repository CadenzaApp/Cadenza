import { authorize, type AuthResult } from "@apple-musickit";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

/**
 * TODO: Replace this with a value fetched from your backend at runtime.
 * Never ship a hardcoded developer token in production — it can be rotated
 * without a new app release if it lives server-side.
 *
 * Generate it by signing a JWT with your MusicKit private key (.p8):
 *   alg: ES256  |  kid: <Key ID>  |  iss: <Team ID>
 *   iat: <now>  |  exp: <now + ≤ 6 months>
 *
 * See: https://developer.apple.com/documentation/applemusicapi/generating_developer_tokens
 */
const DEVELOPER_TOKEN = "eyJhbGciOiJFUzI1NiIsImtpZCI6IjRMN0hSOTVVRFYifQ.eyJpc3MiOiJaVUgyRlg3OTNDIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MzIwMTUwMDB9.YNMlMrkyAAvF6xROfusVkslBaVnki0-IrPj_L4aoOKKtnKdFCxMoS1G6OuJ3qc8Q5ApEASe_UrZB3_PIOSH3CA";

export default function AccountScreen() {
    const [authResult, setAuthResult] = useState<AuthResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const isAuthorized = authResult?.status === "authorized" && !!authResult.userToken;

    async function handleConnectAppleMusic() {
        if (!DEVELOPER_TOKEN) {
            Alert.alert(
                "Developer Token Missing",
                "A developer token is required to connect Apple Music. Set DEVELOPER_TOKEN in account.tsx (fetched from your backend in production)."
            );
            return;
        }

        setIsLoading(true);
        try {
            const result = await authorize(DEVELOPER_TOKEN);
            setAuthResult(result);

            switch (result.status) {
                case "authorized":
                    if (result.userToken) {
                        // TODO: send result.userToken to your backend / store in context
                        Alert.alert("Connected", "Apple Music connected successfully.");
                    } else {
                        Alert.alert(
                            "Authorized",
                            result.error
                                ? `Access granted, but the user token could not be retrieved: ${result.error}`
                                : "Access granted, but no user token was returned."
                        );
                    }
                    break;
                case "denied":
                    Alert.alert(
                        "Access Denied",
                        "Apple Music access was denied. You can enable it in Settings → Privacy → Media & Apple Music."
                    );
                    break;
                case "restricted":
                    Alert.alert(
                        "Access Restricted",
                        "Apple Music access is restricted on this device."
                    );
                    break;
                case "failed":
                    Alert.alert(
                        "Sign-in Failed",
                        result.error ?? "Apple Music sign-in failed. Please try again."
                    );
                    break;
                default:
                    Alert.alert("Unavailable", "Apple Music authorization returned an unknown status.");
            }
        } catch (error) {
            console.error("Apple Music authorization error:", error);
            Alert.alert("Error", "An unexpected error occurred. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }

    function statusLabel(result: AuthResult): string {
        switch (result.status) {
            case "authorized":
                return result.userToken ? "Connected ✓" : "Authorized (no token)";
            case "denied":
                return "Access Denied";
            case "restricted":
                return "Restricted";
            case "notDetermined":
                return "Not Determined";
            case "failed":
                return "Failed";
            default:
                return "Unknown";
        }
    }

    function statusColor(result: AuthResult): string {
        switch (result.status) {
            case "authorized":
                return result.userToken ? "#4ade80" : "#facc15";
            case "denied":
            case "failed":
                return "#f87171";
            case "restricted":
                return "#fb923c";
            default:
                return "#94a3b8";
        }
    }

    return (
        <View style={styles.container}>
            <Text variant="h3" style={styles.title}>
                Account
            </Text>

            {/* Music Services section */}
            <View style={styles.section}>
                <Text variant="large" style={styles.sectionTitle}>
                    Music Services
                </Text>

                <View style={styles.row}>
                    <View style={styles.serviceInfo}>
                        <Text style={styles.serviceLabel}>Apple Music</Text>
                        {authResult !== null && (
                            <Text
                                variant="muted"
                                style={[
                                    styles.statusText,
                                    { color: statusColor(authResult) },
                                ]}
                            >
                                {statusLabel(authResult)}
                            </Text>
                        )}
                    </View>

                    <Button
                        onPress={handleConnectAppleMusic}
                        disabled={isLoading || isAuthorized}
                        variant={isAuthorized ? "outline" : "default"}
                        size="sm"
                    >
                        <Text>
                            {isLoading
                                ? "Connecting…"
                                : isAuthorized
                                    ? "Connected"
                                    : "Connect"}
                        </Text>
                    </Button>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#25292e",
        paddingHorizontal: 24,
        paddingTop: 64,
    },
    title: {
        color: "#fff",
        marginBottom: 32,
    },
    section: {
        backgroundColor: "#1e2228",
        borderRadius: 12,
        padding: 16,
    },
    sectionTitle: {
        color: "#fff",
        marginBottom: 16,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    serviceInfo: {
        flex: 1,
        marginRight: 12,
    },
    serviceLabel: {
        color: "#fff",
        fontSize: 15,
    },
    statusText: {
        marginTop: 3,
    },
});
