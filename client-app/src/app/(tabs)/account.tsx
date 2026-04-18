import { AuthStatus, type AuthResult } from "@apple-musickit";
import { useState } from "react";
import { Alert, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppleMusic } from "@/lib/apple-music";

export default function AccountScreen() {
    const { authResult, connect, disconnect } = useAppleMusic();
    const [isLoading, setIsLoading] = useState(false);

    const hasAuthState = authResult !== null;

    async function handleConnectAppleMusic() {
        setIsLoading(true);
        try {
            const result = await connect();
            if (!result) return;

            switch (result.status) {
                case AuthStatus.Authorized:
                    if (result.userToken) {
                        Alert.alert(
                            "Connected",
                            "Apple Music connected successfully.",
                        );
                    } else {
                        Alert.alert(
                            "Authorized",
                            result.error ?? "No user token was returned.",
                        );
                    }
                    break;
                case AuthStatus.Denied:
                    Alert.alert(
                        "Access Denied",
                        "Apple Music access was denied.",
                    );
                    break;
                case AuthStatus.Restricted:
                    Alert.alert(
                        "Access Restricted",
                        "Apple Music access is restricted.",
                    );
                    break;
                case AuthStatus.Unknown:
                case AuthStatus.NotDetermined:
                    Alert.alert(
                        "Sign-in Failed",
                        result.error ?? "Status unknown.",
                    );
                    break;
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
            case AuthStatus.Authorized:
                return result.userToken
                    ? "Connected ✓"
                    : "Authorized (no token)";
            case AuthStatus.Denied:
                return "Access Denied";
            case AuthStatus.Restricted:
                return "Restricted";
            case AuthStatus.NotDetermined:
                return "Not Determined";
            default:
                return "Unknown";
        }
    }

    function statusColorClass(result: AuthResult): string {
        switch (result.status) {
            case AuthStatus.Authorized:
                return result.userToken ? "text-green-500" : "text-yellow-500";
            case AuthStatus.Denied:
                return "text-destructive";
            case AuthStatus.Restricted:
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
                                    {authResult.status === AuthStatus.Authorized
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
