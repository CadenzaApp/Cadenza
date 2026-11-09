import type { ReactNode } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import type { MusicFeature } from "@/lib/music-access";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { APPLE_MUSIC_NEBULA } from "@/lib/theme";
import { useMusicAccess } from "@/lib/use-music-access";

import {
    AppleMusicBlurb,
    AppleMusicHero,
    AppleMusicUnlocks,
    ConnectAppleMusicActions,
    WhichAccountNote,
} from "./apple-music-connect-ui";
import { useConnectAppleMusic } from "./apple-music-connection";

/** Why this screen needs Apple Music, as the line under the hero. */
const REASON: Partial<Record<MusicFeature, string>> = {
    library:
        "Your library lives in Apple Music. Connect it to see and tag the songs, albums, and playlists you already have.",
    playlists:
        "Playlists live in Apple Music. Connect it to add songs to yours or make new ones.",
};

const FALLBACK_REASON = "This needs Apple Music connected.";

/**
 * Renders `children` when the music tier allows `feature`, else the Apple
 * Music connect page in their place: the onboarding step's content, on its
 * nebula, connecting right here rather than opening a sheet. Works in a tab
 * or a sheet, since the scroll insets come from the screen it is on.
 */
export function GatedFeature({
    feature,
    children,
}: {
    feature: MusicFeature;
    children: ReactNode;
}) {
    const { can } = useMusicAccess();
    if (can(feature)) return children;
    return <ConnectInPlace reason={REASON[feature] ?? FALLBACK_REASON} />;
}

function ConnectInPlace({ reason }: { reason: string }) {
    const scroll = useScreenScroll();
    const { listBottomInset } = useScreenOverlayInsets();
    const { connectAppleMusic, isConnecting, message, lastStatus } =
        useConnectAppleMusic();

    return (
        <View className="flex-1">
            <View pointerEvents="none" className="absolute inset-0">
                <NebulaBackdrop colors={APPLE_MUSIC_NEBULA} layout="full" />
            </View>
            <ScreenScrollMarker>
                <Animated.ScrollView
                    {...scroll}
                    className="flex-1"
                    contentContainerClassName="flex-grow justify-center gap-6 px-6 pt-6"
                    contentContainerStyle={[
                        { paddingBottom: listBottomInset + 24 },
                        scroll.contentContainerStyle,
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    <AppleMusicHero title="Connect Apple Music">
                        <AppleMusicBlurb>{reason}</AppleMusicBlurb>
                    </AppleMusicHero>
                    <AppleMusicUnlocks />
                    <ConnectAppleMusicActions
                        label="Connect Apple Music"
                        onConnect={() => void connectAppleMusic()}
                        isConnecting={isConnecting}
                        message={message}
                        lastStatus={lastStatus}
                    />
                    <WhichAccountNote />
                </Animated.ScrollView>
            </ScreenScrollMarker>
        </View>
    );
}
