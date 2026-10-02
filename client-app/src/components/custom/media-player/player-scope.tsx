import { useLocalSearchParams, useRouter } from "expo-router";
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import { usePlaybackTrackState } from "@/lib/playback";

export type FocusedSong = {
    id: string;
    title: string;
    artworkUrl?: string;
    artworkColor?: string;
};

type PlayerScopeValue = {
    focusedSong: FocusedSong;
};

const PlayerScopeContext = createContext<PlayerScopeValue | null>(null);

/**
 * State shared by the three native tabs in the now-playing sheet. It keeps a
 * tag target stable while the native navigator switches screens.
 */
export function PlayerScopeProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const { activeTrack } = usePlaybackTrackState();
    const params = useLocalSearchParams<{
        tagsSongId?: string;
        tagsSongTitle?: string;
        tagsArtworkUrl?: string;
        tagsArtworkColor?: string;
    }>();
    const routeTarget = useMemo<FocusedSong | null>(
        () =>
            params.tagsSongId
                ? {
                      id: params.tagsSongId,
                      title: params.tagsSongTitle ?? "",
                      artworkUrl: params.tagsArtworkUrl || undefined,
                      artworkColor: params.tagsArtworkColor || undefined,
                  }
                : null,
        [
            params.tagsArtworkColor,
            params.tagsArtworkUrl,
            params.tagsSongId,
            params.tagsSongTitle,
        ],
    );
    const [pinnedSong] = useState<FocusedSong | null>(routeTarget);
    const focusedSong =
        pinnedSong ??
        (activeTrack
            ? {
                  id: activeTrack.catalogId ?? activeTrack.id,
                  title: activeTrack.title,
                  artworkUrl: activeTrack.artworkUrl,
                  artworkColor: activeTrack.artworkColor,
              }
            : null);

    // Playback can stop while the sheet is open. A route target still leaves
    // Comments and Tags with a useful song, so only the plain player closes.
    useEffect(() => {
        if (!activeTrack && !pinnedSong && router.canGoBack()) {
            router.back();
        }
    }, [activeTrack, pinnedSong, router]);

    const value = focusedSong ? { focusedSong } : null;

    return value ? (
        <PlayerScopeContext.Provider value={value}>
            {children}
        </PlayerScopeContext.Provider>
    ) : null;
}

export function usePlayerScope() {
    const value = useContext(PlayerScopeContext);
    if (!value) {
        throw new Error(
            "usePlayerScope must be used inside PlayerScopeProvider",
        );
    }
    return value;
}
