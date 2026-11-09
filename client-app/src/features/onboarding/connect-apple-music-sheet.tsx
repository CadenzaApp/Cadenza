import { AuthStatus } from "@apple-musickit";
import { useRouter } from "expo-router";
import { Linking, Pressable, View } from "react-native";

import { AppleMusicLogo } from "@/components/custom/apple-music-logo";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import { Text } from "@/components/ui/text";
import { useConnectAppleMusic } from "@/features/account/apple-music-connection";
import { SettingsPoints, SettingsSheet } from "@/features/account/settings-ui";

import { WHAT_IT_UNLOCKS, WHICH_ACCOUNT } from "./connect-copy";
import { APPLE_MUSIC_NEBULA } from "./onboarding-backdrop";

/**
 * - `connect`: opened from a gated screen, like Library without Apple Music.
 * - `reconnect`: opened when Apple drops the connection.
 */
export type ConnectSheetMode = "connect" | "reconnect";

const COPY: Record<ConnectSheetMode, { title: string; body: string }> = {
    connect: {
        title: "Connect Apple Music",
        body: "Bring in your library and playlists, and play full songs with a subscription.",
    },
    reconnect: {
        title: "Reconnect Apple Music",
        body: "Apple ended the saved sign in. Until you reconnect, Cadenza plays previews and your library is hidden.",
    },
};

/**
 * Connecting Apple Music from inside the app, on the same sheet as the
 * Account screens. Closes itself once connected; dragging it down is "not now".
 */
export function ConnectAppleMusicSheet({ mode }: { mode: ConnectSheetMode }) {
    const router = useRouter();
    const { connectAppleMusic, isConnecting, message, lastStatus } =
        useConnectAppleMusic();
    const copy = COPY[mode];

    async function connect() {
        const result = await connectAppleMusic();
        if (result?.status === AuthStatus.Authorized && result.userToken) {
            router.back();
        }
    }

    return (
        <SettingsSheet title={copy.title} nebulaColors={APPLE_MUSIC_NEBULA}>
            <GlassPanel>
                <View className="items-center gap-2 px-5 py-6">
                    <AppleMusicLogo size={64} />
                    <Text className="mt-1 text-center text-sm leading-5 text-muted-foreground">
                        {copy.body}
                    </Text>
                    {message ? (
                        <Text
                            accessibilityRole="alert"
                            className="text-center text-sm leading-5 text-muted-foreground"
                        >
                            {message}
                        </Text>
                    ) : null}
                    {lastStatus === AuthStatus.Denied ? (
                        <Pressable
                            accessibilityRole="link"
                            onPress={() => void Linking.openSettings()}
                            className="active:opacity-60"
                        >
                            <Text className="text-center text-sm font-semibold underline">
                                Allow access in Settings
                            </Text>
                        </Pressable>
                    ) : null}
                    <View className="mt-2">
                        <GlassPill
                            size="md"
                            icon="link-outline"
                            label={copy.title}
                            loading={isConnecting}
                            onPress={() => void connect()}
                        />
                    </View>
                </View>
            </GlassPanel>

            <SettingsPoints points={WHAT_IT_UNLOCKS} />

            <Text className="px-2 text-sm leading-5 text-muted-foreground">
                {WHICH_ACCOUNT}
            </Text>
        </SettingsSheet>
    );
}
