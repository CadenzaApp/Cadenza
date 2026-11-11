import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import { usePlaybackTrackState } from "@/lib/playback";
import { useMyLiveSession } from "@/lib/routes/live-sessions";

export type FocusedSong = {
    id: string;
    title: string;
    artworkUrl?: string;
    artworkColor?: string;
};

type PlayerScopeValue = {
    /** Null only in a live session with nothing playing. */
    focusedSong: FocusedSong | null;
};

const PlayerScopeContext = createContext<PlayerScopeValue | null>(null);

/**
 * State shared by the three native tabs in the now-playing sheet. It keeps a
 * tag target stable while the native navigator switches screens.
 */
export function PlayerScopeProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const focused = useIsFocused();
    const { activeTrack } = usePlaybackTrackState();
    // a live session keeps the sheet open with nothing playing, since its
    // controls live here. The id is known before the session loads, so a
    // sheet opened right after starting one does not close on the way
    const inSession = useMyLiveSession().mySessionId !== null;
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
    // Discuss and Tags with a useful song, so only the plain player closes.
    useEffect(() => {
        if (
            focused &&
            !activeTrack &&
            !pinnedSong &&
            !inSession &&
            router.canGoBack()
        ) {
            router.back();
        }
    }, [activeTrack, pinnedSong, focused, inSession, router]);

    const value = focusedSong || inSession ? { focusedSong } : null;

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
