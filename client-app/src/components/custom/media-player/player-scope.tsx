import type { MusicItem } from "@apple-musickit";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import { usePlaybackTrackState } from "@/lib/playback";

import { usePlayerTabs } from "./player-tabs";

export type FocusedSong = {
    id: string;
    title: string;
    artworkUrl?: string;
    artworkColor?: string;
};

type PlayerScopeValue = {
    focusedSong: FocusedSong;
    showTagsFor: (track: MusicItem) => void;
};

const PlayerScopeContext = createContext<PlayerScopeValue | null>(null);

function focusedSongFromTrack(track: MusicItem): FocusedSong {
    return {
        id: track.catalogId ?? track.id,
        title: track.title,
        artworkUrl: track.artworkUrl,
        artworkColor: track.artworkColor,
    };
}

/**
 * State shared by the three native tabs in the now-playing sheet. It keeps a
 * tag target stable while the native navigator switches screens.
 */
export function PlayerScopeProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const { selectTab } = usePlayerTabs();
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
    const [pinnedSong, setPinnedSong] = useState<FocusedSong | null>(
        routeTarget,
    );
    const focusedSong =
        pinnedSong ?? (activeTrack ? focusedSongFromTrack(activeTrack) : null);

    // Playback can stop while the sheet is open. A route target still leaves
    // Comments and Tags with a useful song, so only the plain player closes.
    useEffect(() => {
        if (!activeTrack && !pinnedSong && router.canGoBack()) {
            router.back();
        }
    }, [activeTrack, pinnedSong, router]);

    const showTagsFor = useCallback(
        (track: MusicItem) => {
            const target = focusedSongFromTrack(track);
            setPinnedSong(target);
            selectTab("tags");
        },
        [selectTab],
    );

    const value = useMemo(
        () => (focusedSong ? { focusedSong, showTagsFor } : null),
        [focusedSong, showTagsFor],
    );

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
