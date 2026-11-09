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
 * - `connect`: opened from a gated screen, like Library without Apple Music.
 * - `reconnect`: opened when Apple drops the connection.
 */
export type ConnectSheetMode = "connect" | "reconnect";

const COPY: Record<ConnectSheetMode, { title: string; body: string }> = {
    connect: {
        title: "Connect Apple Music",
        body: "Bring in your library and playlists, and play full songs with a subscription. Without it you can still search, tag, and hear 30 second previews.",
    },
    reconnect: {
        title: "Reconnect Apple Music",
        body: "Apple ended the saved sign in. Until you reconnect, Cadenza plays previews and your library is hidden.",
    },
};

/**
 * Connecting Apple Music from inside the app: the onboarding step's page, on
 * the shared sheet with the Apple Music nebula. Closes itself once connected.
 * The hero carries the title, so the sheet's own header is left blank.
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
        <SettingsSheet
            title=""
            nebulaColors={APPLE_MUSIC_NEBULA}
            className="gap-6"
        >
            <AppleMusicHero title={copy.title}>
                <AppleMusicBlurb>{copy.body}</AppleMusicBlurb>
            </AppleMusicHero>
            <AppleMusicUnlocks />
            <ConnectAppleMusicActions
                label={copy.title}
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
