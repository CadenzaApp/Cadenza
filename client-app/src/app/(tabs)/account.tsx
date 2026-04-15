import { Auth, type AuthResult } from "@apple-musickit";
import { useState } from "react";
import { Alert, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * TODO: Replace this with a value fetched from your backend at runtime.
 * Never ship a hardcoded developer token in production — it can be rotated
 * without a new app release if it lives server-side.
 */
const DEVELOPER_TOKEN =
    "eyJhbGciOiJFUzI1NiIsImtpZCI6IjRMN0hSOTVVRFYifQ.eyJpc3MiOiJaVUgyRlg3OTNDIiwiaWF0IjoxNzc2MTIxMzU1LCJleHAiOjE3OTE4NDYxNTV9.HCcvJ-iHzFBTPP2R1w3-fC1NGLHxzBp2avq2FvwOkK8vqB_bo2Qhs6WthS84EVtGhsstJDJw_CHNGwPQEEIXMA";

export default function AccountScreen() {
    const [authResult, setAuthResult] = useState<AuthResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const hasAuthState = authResult !== null;

    async function handleConnectAppleMusic() {
        if (!DEVELOPER_TOKEN) {
            Alert.alert(
                "Developer Token Missing",
                "A developer token is required to connect Apple Music. Set DEVELOPER_TOKEN in account.tsx (fetched from your backend in production).",
            );
            return;
        }

        setIsLoading(true);
        try {
            const result = await Auth.authorize(DEVELOPER_TOKEN);
            setAuthResult(result);

            switch (result.status) {
                case "authorized":
                    if (result.userToken) {
                        // TODO: send result.userToken to your backend / store in context
                        Alert.alert(
                            "Connected",
                            "Apple Music connected successfully.",
                        );
                    } else {
                        Alert.alert(
                            "Authorized",
                            result.error
                                ? `Access granted, but the user token could not be retrieved: ${result.error}`
                                : "Access granted, but no user token was returned.",
                        );
                    }
                    break;
                case "denied":
                    Alert.alert(
                        "Access Denied",
                        "Apple Music access was denied. You can enable it in Settings → Privacy → Media & Apple Music.",
                    );
                    break;
                case "restricted":
                    Alert.alert(
                        "Access Restricted",
                        "Apple Music access is restricted on this device.",
                    );
                    break;
                case "failed":
                    Alert.alert(
                        "Sign-in Failed",
                        result.error ??
                            "Apple Music sign-in failed. Please try again.",
                    );
                    break;
                default:
                    Alert.alert(
                        "Unavailable",
                        "Apple Music authorization returned an unknown status.",
                    );
            }
        } catch (error) {
            console.error("Apple Music authorization error:", error);
            Alert.alert(
                "Error",
                "An unexpected error occurred. Please try again.",
            );
        } finally {
            setIsLoading(false);
        }
    }

    function handleDisconnect() {
        Alert.alert(
            "Sign Out",
            "Are you sure you want to disconnect Apple Music?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Sign Out",
                    style: "destructive",
                    onPress: () => {
                        // Clear the local state
                        setAuthResult(null);

                        // TODO: Also clear the saved token from your backend or local secure store here

                        Alert.alert(
                            "Disconnected",
                            "You have been signed out of Apple Music.",
                        );
                    },
                },
            ],
        );
    }

    function statusLabel(result: AuthResult): string {
        switch (result.status) {
            case "authorized":
                return result.userToken
                    ? "Connected ✓"
                    : "Authorized (no token)";
            case "denied":
                return "Access Denied";
            case "restricted":
                return "Restricted";
            case "notDetermined":
                return "Not Determined";
            default:
                return "Unknown";
        }
    }

    // Refactored to return Tailwind text color classes instead of hex codes
    function statusColorClass(result: AuthResult): string {
        switch (result.status) {
            case "authorized":
                return result.userToken ? "text-green-500" : "text-yellow-500";
            case "denied":
                return "text-destructive";
            case "restricted":
                return "text-orange-500";
            default:
                return "text-muted-foreground";
        }
    }

    return (
        <View className="flex-1 bg-background px-6 pt-16">
            <Text className="text-3xl font-bold text-foreground mb-8">
                Account
            </Text>

            {/* Music Services Card */}
            <Card className="w-full">
                <CardHeader>
                    <CardTitle className="text-xl">Music Services</CardTitle>
                </CardHeader>

                <CardContent>
                    <View className="flex-row items-center justify-between">
                        <View className="flex-1 mr-3">
                            <Text className="text-base font-medium text-foreground">
                                Apple Music
                            </Text>
                            {authResult !== null && (
                                <Text
                                    className={`mt-1 text-sm ${statusColorClass(authResult)}`}
                                >
                                    {statusLabel(authResult)}
                                </Text>
                            )}
                        </View>

                        {hasAuthState ? (
                            <Button
                                onPress={handleDisconnect}
                                variant="outline"
                                size="sm"
                            >
                                <Text className="text-destructive">
                                    {authResult.status === "authorized"
                                        ? "Sign Out"
                                        : "Clear Status"}
                                </Text>
                            </Button>
                        ) : (
                            <Button
                                onPress={handleConnectAppleMusic}
                                disabled={isLoading}
                                size="sm"
                            >
                                <Text>
                                    {isLoading ? "Connecting…" : "Connect"}
                                </Text>
                            </Button>
                        )}
                    </View>
                </CardContent>
            </Card>
        </View>
    );
}
