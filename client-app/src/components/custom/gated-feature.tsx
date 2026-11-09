import type { ReactNode } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import { AppleMusicLogo } from "@/components/custom/apple-music-logo";
import { GlassPill } from "@/components/ui/glass-pill";
import { Text } from "@/components/ui/text";
import type { MusicFeature } from "@/lib/music-access";
import { useMusicAccess } from "@/lib/use-music-access";

const COPY: Partial<Record<MusicFeature, { title: string; body: string }>> = {
    library: {
        title: "Your library lives in Apple Music",
        body: "Connect Apple Music to see and tag the songs, albums, and playlists you already have.",
    },
    playlists: {
        title: "Playlists need Apple Music",
        body: "Connect Apple Music to add songs to your playlists or make new ones.",
    },
};

const FALLBACK = {
    title: "This needs Apple Music",
    body: "Connect Apple Music to use it.",
};

/**
 * Renders `children` when the music tier allows `feature`, else a prompt to
 * connect Apple Music in their place. The one empty state every gated screen
 * shares, so none of them errors or shows a blank list without a connection.
 */
export function GatedFeature({
    feature,
    children,
}: {
    feature: MusicFeature;
    children: ReactNode;
}) {
    const { can } = useMusicAccess();
    const router = useRouter();
    if (can(feature)) return children;

    const copy = COPY[feature] ?? FALLBACK;
    return (
        <View className="flex-1 items-center justify-center gap-3 px-8 py-12">
            <AppleMusicLogo size={64} />
            <Text className="mt-2 text-center text-xl font-semibold">
                {copy.title}
            </Text>
            <Text className="text-center text-sm leading-5 text-muted-foreground">
                {copy.body}
            </Text>
            <View className="mt-3">
                <GlassPill
                    size="md"
                    icon="link-outline"
                    label="Connect Apple Music"
                    onPress={() => router.push("/connect-apple-music")}
                />
            </View>
        </View>
    );
}
