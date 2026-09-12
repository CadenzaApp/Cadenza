import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";

import { getAccountInitials } from "./account-initials";

type Props = {
    title: string;
    /** Screen-specific controls, placed left of the account button. */
    actions?: ReactNode;
};

export function TopRail({ title, actions }: Props) {
    const router = useRouter();
    const { account } = useAccount();
    const insets = useSafeAreaInsets();

    return (
        <View
            className="border-b border-border bg-background"
            style={{ paddingTop: insets.top }}
        >
            <View className="h-16 flex-row items-center justify-between px-5">
                <Text
                    className="flex-1 text-3xl font-bold tracking-tight"
                    numberOfLines={1}
                >
                    {title}
                </Text>

                <View className="flex-row items-center gap-2">
                    {actions}
                    <GlassIconButton
                        accessibilityLabel="Open account"
                        onPress={() => router.push("/account")}
                    >
                        <Text className="text-sm font-semibold">
                            {getAccountInitials(account?.email)}
                        </Text>
                    </GlassIconButton>
                </View>
            </View>
        </View>
    );
}
