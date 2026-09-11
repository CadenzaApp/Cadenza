import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";

import { getAccountInitials } from "./account-initials";

type Props = {
    title: string;
};

export function TopRail({ title }: Props) {
    const router = useRouter();
    const { account } = useAccount();
    const insets = useSafeAreaInsets();

    return (
        <View
            className="border-b border-border bg-background"
            style={{ paddingTop: insets.top }}
        >
            <View className="h-16 flex-row items-center justify-between px-5">
                <Text className="text-3xl font-bold tracking-tight">
                    {title}
                </Text>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open account"
                    hitSlop={8}
                    onPress={() => router.push("/account")}
                    className="h-10 w-10 items-center justify-center rounded-full border border-border bg-muted"
                    style={({ pressed }) =>
                        pressed ? { opacity: 0.65 } : undefined
                    }
                >
                    <Text className="text-sm font-semibold">
                        {getAccountInitials(account?.email)}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}
