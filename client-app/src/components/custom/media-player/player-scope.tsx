import type { MusicItem } from "@apple-musickit";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import { usePlayback } from "@/lib/playback";

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
    const { activeTrack } = usePlayback();
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
    const [focusedSong, setFocusedSong] = useState<FocusedSong | null>(
        routeTarget ?? (activeTrack ? focusedSongFromTrack(activeTrack) : null),
    );
    const [canStayWithoutPlayback, setCanStayWithoutPlayback] = useState(
        routeTarget != null,
    );

    // Playback can stop while the sheet is open. A route target still leaves
    // Comments and Tags with a useful song, so only the plain player closes.
    useEffect(() => {
        if (!activeTrack && !canStayWithoutPlayback && router.canGoBack()) {
            router.back();
        }
    }, [activeTrack, canStayWithoutPlayback, router]);

    if (!focusedSong) return null;

    function showTagsFor(track: MusicItem) {
        const target = focusedSongFromTrack(track);
        setFocusedSong(target);
        setCanStayWithoutPlayback(true);
        router.navigate({
            pathname: "/player/tags",
            params: {
                tagsSongId: target.id,
                tagsSongTitle: target.title,
                tagsArtworkUrl: target.artworkUrl ?? "",
                tagsArtworkColor: target.artworkColor ?? "",
            },
        });
    }

    return (
        <PlayerScopeContext.Provider value={{ focusedSong, showTagsFor }}>
            {children}
        </PlayerScopeContext.Provider>
    );
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
