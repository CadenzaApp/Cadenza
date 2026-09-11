import Ionicons from "@expo/vector-icons/Ionicons";
import { AuthStatus, type AuthResult } from "@apple-musickit";
import { Redirect, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getAccountInitials } from "@/components/custom/account-initials";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useAppleMusic } from "@/lib/apple-music-auth";

export default function AccountScreen() {
    const router = useRouter();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { account, signOut } = useAccount();
    const { authResult, isConnected, connect, disconnect } = useAppleMusic();
    const [isConnecting, setIsConnecting] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);

    const hasAuthState = authResult !== null;

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    async function handleConnectAppleMusic() {
        setIsConnecting(true);
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
                            "Not Connected",
                            result.error ??
                                "Apple Music authorized access but did not return a user token. Please try connecting again.",
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
            console.error("Apple Music connection error:", error);
            Alert.alert(
                "Error",
                "An unexpected error occurred. Please try again.",
            );
        } finally {
            setIsConnecting(false);
        }
    }

    function handleDisconnectAppleMusic() {
        Alert.alert(
            "Disconnect Apple Music",
            "Are you sure you want to disconnect Apple Music?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Disconnect",
                    style: "destructive",
                    onPress: async () => {
                        await disconnect();
                        Alert.alert(
                            "Disconnected",
                            "Apple Music has been disconnected.",
                        );
                    },
                },
            ],
        );
    }

    function handleSignOut() {
        Alert.alert(
            "Sign Out",
            "Are you sure you want to sign out of Cadenza?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Sign Out",
                    style: "destructive",
                    onPress: () => void finishSignOut(),
                },
            ],
        );
    }

    async function finishSignOut() {
        setIsSigningOut(true);
        try {
            await signOut();
            router.replace("/auth?initialMode=signin");
        } catch (error) {
            console.error("Cadenza sign-out error:", error);
            Alert.alert("Sign Out Failed", "Please try again.");
        } finally {
            setIsSigningOut(false);
        }
    }

    function statusLabel(result: AuthResult): string {
        switch (result.status) {
            case AuthStatus.Authorized:
                return result.userToken
                    ? "Connected"
                    : "Not Connected (no token)";
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
        <View className="flex-1 bg-card">
            <View
                className="bg-card"
                style={{
                    paddingTop: Platform.OS === "ios" ? 12 : insets.top,
                }}
            >
                <View className="h-16 flex-row items-center justify-between px-5">
                    <Text className="text-3xl font-bold tracking-tight">
                        Account
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close account"
                        hitSlop={8}
                        onPress={() => router.back()}
                        className="h-10 w-10 items-center justify-center rounded-full bg-muted"
                        style={({ pressed }) =>
                            pressed ? { opacity: 0.65 } : undefined
                        }
                    >
                        <Ionicons name="close" size={22} color={colors.text} />
                    </Pressable>
                </View>
            </View>

            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-4 px-5 pt-3"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                <Card className="gap-0 bg-muted py-0">
                    <CardContent className="flex-row items-center gap-4 py-5">
                        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary">
                            <Text className="text-xl font-semibold text-primary-foreground">
                                {getAccountInitials(account.email)}
                            </Text>
                        </View>
                        <View className="flex-1 gap-1">
                            <Text className="text-lg font-semibold">
                                Cadenza Account
                            </Text>
                            <Text
                                className="text-sm text-muted-foreground"
                                numberOfLines={1}
                            >
                                {account.email}
                            </Text>
                        </View>
                    </CardContent>
                </Card>

                <Card className="gap-0 bg-muted py-0">
                    <CardHeader className="py-5 pb-3">
                        <CardTitle className="text-xl">
                            Music Services
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-5">
                        <View className="flex-row items-center justify-between">
                            <View className="mr-3 flex-1">
                                <Text className="text-base font-medium">
                                    Apple Music
                                </Text>
                                {hasAuthState ? (
                                    <Text
                                        className={`mt-1 text-sm ${statusColorClass(authResult)}`}
                                    >
                                        {statusLabel(authResult)}
                                    </Text>
                                ) : null}
                            </View>

                            {isConnected ? (
                                <Button
                                    onPress={handleDisconnectAppleMusic}
                                    variant="outline"
                                    size="sm"
                                >
                                    <Text className="text-destructive">
                                        Disconnect
                                    </Text>
                                </Button>
                            ) : (
                                <Button
                                    onPress={handleConnectAppleMusic}
                                    disabled={isConnecting}
                                    size="sm"
                                >
                                    <Text>
                                        {isConnecting
                                            ? "Connecting..."
                                            : "Connect"}
                                    </Text>
                                </Button>
                            )}
                        </View>
                    </CardContent>
                </Card>

                <Card className="gap-0 bg-muted py-0">
                    <CardHeader className="py-5 pb-3">
                        <CardTitle className="text-xl">Session</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-5">
                        <Button
                            variant="destructive"
                            onPress={handleSignOut}
                            disabled={isSigningOut}
                            className="w-full"
                        >
                            <Text>
                                {isSigningOut ? "Signing out..." : "Sign Out"}
                            </Text>
                        </Button>
                    </CardContent>
                </Card>
            </ScrollView>
        </View>
    );
}
