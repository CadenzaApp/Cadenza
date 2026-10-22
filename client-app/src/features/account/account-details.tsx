import { Redirect } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailScreen } from "@/components/ui/detail-screen";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useProfile } from "@/lib/routes/profile";
import { useOpenSocialProfile } from "@/lib/use-open-social-profile";

import { SettingsGroup, SettingsRow } from "./settings-ui";

/** The Cadenza account: email and username. Username is edited on Social. */
export function AccountDetailsScreen() {
    const insets = useSafeAreaInsets();
    const { account } = useAccount();
    const { profile } = useProfile(Boolean(account));
    const openSocialProfile = useOpenSocialProfile();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    return (
        <DetailScreen presentation="sheet" title="Account details">
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-4 px-5 pt-2"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                <SettingsGroup>
                    <SettingsRow
                        icon="mail-outline"
                        title="Email"
                        description={account.email}
                    />
                    <SettingsRow
                        icon="at-outline"
                        title="Username"
                        description={profile?.username ?? "Not set"}
                        chevron
                        onPress={() => openSocialProfile(account.id)}
                        accessibilityLabel="Edit your username on your social page"
                    />
                </SettingsGroup>
                <Text className="px-2 text-sm leading-5 text-muted-foreground">
                    Your username and bio are edited from your social page.
                </Text>
            </ScrollView>
        </DetailScreen>
    );
}
