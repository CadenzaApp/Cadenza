import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

import { getAccountInitials } from "@/components/custom/account-initials";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useProfile } from "@/lib/routes/profile";
import { useAppTheme } from "@/lib/theme";

/** How far below center the initial sits, as a share of the avatar. */
const INITIAL_NUDGE = 0.035;

/**
 * Who is signed in: the username, else the email local part while the profile
 * loads, and the initial to draw for it.
 */
export function useAccountIdentity() {
    const { account } = useAccount();
    const { profile, profileLoading } = useProfile(Boolean(account));
    const email = account?.email ?? "";
    const emailName = email.split("@", 1)[0] ?? email;

    return {
        profile,
        profileLoading,
        displayName: profile?.username ?? emailName,
        initial: profile?.username
            ? profile.username.charAt(0).toUpperCase()
            : getAccountInitials(email),
    };
}

/** A large accent circle with the user's initial. */
export function AccountAvatar({
    initial,
    size = 96,
}: {
    initial: string;
    size?: number;
}) {
    const { colors } = useAppTheme();

    return (
        <View
            className="items-center justify-center overflow-hidden rounded-full"
            style={{
                width: size,
                height: size,
                backgroundColor: colors.brand,
            }}
        >
            {/* a soft highlight from the top, so the flat fill reads round */}
            <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
                style={StyleSheet.absoluteFill}
            />
            {/* a capital sits high in its line box, so nudge it down to
                look centered in the circle */}
            <Text
                className="font-bold"
                style={{
                    color: colors.brandForeground,
                    fontSize: size * 0.5,
                    lineHeight: size * 0.5,
                    transform: [{ translateY: size * INITIAL_NUDGE }],
                    includeFontPadding: false,
                }}
            >
                {initial}
            </Text>
        </View>
    );
}

/** "March 2026", or "-" for a date that does not parse. */
export function memberSince(createdAt: string): string {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
    });
}
