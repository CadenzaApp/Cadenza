import { type AuthResult } from "@apple-musickit";
import { useState } from "react";
import { Alert, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppleMusic } from "@/lib/apple-music"; // <-- Use the new hook

export default function AccountScreen() {
    // Consume our single source of truth
    const { authResult, connect, disconnect } = useAppleMusic();
    const [isLoading, setIsLoading] = useState(false);

    const hasAuthState = authResult !== null;

    async function handleConnectAppleMusic() {
        setIsLoading(true);
        try {
            const result = await connect();
            if (!result) return;

            switch (result.status) {
                case "authorized":
                    if (result.userToken) {
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
                    onPress: async () => {
                        await disconnect();
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
