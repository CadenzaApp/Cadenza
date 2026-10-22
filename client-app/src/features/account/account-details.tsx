import { Redirect } from "expo-router";

import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useProfile } from "@/lib/routes/profile";
import { useOpenSocialProfile } from "@/lib/use-open-social-profile";

import { SettingsGroup, SettingsRow, SettingsSheet } from "./settings-ui";

/** The Cadenza account: email and username. Username is edited on Social. */
export function AccountDetailsScreen() {
    const { account } = useAccount();
    const { profile, profileLoading } = useProfile(Boolean(account));
    const openSocialProfile = useOpenSocialProfile();

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    return (
        <SettingsSheet title="Account details">
            <SettingsGroup>
                <SettingsRow
                    icon="mail-outline"
                    title="Email"
                    description={account.email}
                />
                <SettingsRow
                    icon="at-outline"
                    title="Username"
                    description={
                        profile?.username ??
                        (profileLoading ? "Loading..." : "Not set")
                    }
                    chevron
                    onPress={() => openSocialProfile(account.id)}
                    accessibilityLabel="Edit your username on your social page"
                />
            </SettingsGroup>
            <Text className="px-2 text-sm leading-5 text-muted-foreground">
                Your username and bio are edited from your social page.
            </Text>
        </SettingsSheet>
    );
}
