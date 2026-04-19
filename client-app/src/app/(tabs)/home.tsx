import { useAccount } from "@/lib/account";
import { Redirect } from "expo-router";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

export default function HomeScreen() {
    const { account, signOut } = useAccount();

    if (!account) return <Redirect href="/auth?initialMode=signin" />;

    return (
        <View className="flex-1 bg-background items-center justify-center gap-4">
            <Text variant="large">Hello, {account.email}</Text>
            <Button variant="secondary" onPress={signOut}>
                <Text>Sign out</Text>
            </Button>
        </View>
    );
}
