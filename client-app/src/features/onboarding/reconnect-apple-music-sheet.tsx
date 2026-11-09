import { AuthStatus } from "@apple-musickit";
import { useRouter } from "expo-router";

import {
    AppleMusicBlurb,
    AppleMusicHero,
    AppleMusicUnlocks,
    ConnectAppleMusicActions,
    WhichAccountNote,
} from "@/features/account/apple-music-connect-ui";
import { useConnectAppleMusic } from "@/features/account/apple-music-connection";
import { SettingsSheet } from "@/features/account/settings-ui";
import { APPLE_MUSIC_NEBULA } from "@/lib/theme";

/**
 * Reconnecting after Apple drops the connection: the onboarding step's page,
 * on the shared sheet with the Apple Music nebula, so it can open over any
 * screen. Closes itself once connected. The hero carries the title, so the
 * sheet's own header is left blank. A screen that needs Apple Music from the
 * start shows the same page in place instead (`GatedFeature`).
 */
export function ReconnectAppleMusicSheet() {
    const router = useRouter();
    const { connectAppleMusic, isConnecting, message, lastStatus } =
        useConnectAppleMusic();

    async function connect() {
        const result = await connectAppleMusic();
        if (result?.status === AuthStatus.Authorized && result.userToken) {
            router.back();
        }
    }

    return (
        <SettingsSheet
            title=""
            nebulaColors={APPLE_MUSIC_NEBULA}
            className="gap-6"
        >
            <AppleMusicHero title="Reconnect Apple Music">
                <AppleMusicBlurb>
                    Apple ended the saved sign in. Until you reconnect, Cadenza
                    plays previews and your library is hidden.
                </AppleMusicBlurb>
            </AppleMusicHero>
            <AppleMusicUnlocks />
            <ConnectAppleMusicActions
                label="Reconnect Apple Music"
                onConnect={() => void connect()}
                isConnecting={isConnecting}
                message={message}
                lastStatus={lastStatus}
                secondary={{
                    label: "Continue with previews",
                    onPress: () => router.back(),
                }}
            />
            <WhichAccountNote />
        </SettingsSheet>
    );
}
