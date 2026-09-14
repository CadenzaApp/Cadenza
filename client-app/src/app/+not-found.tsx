import { View } from "react-native";
import { Link, Stack } from "expo-router";
import { Text } from "@/components/ui/text";

export default function NotFoundScreen() {
    return (
        <>
            <Stack.Screen options={{ title: "Oops! Not Found" }} />
            <View className="flex-1 bg-background items-center justify-center">
                <Link href="/library">
                    <Text className="text-xl underline text-foreground">
                        Go to Library
                    </Text>
                </Link>
            </View>
        </>
    );
}
