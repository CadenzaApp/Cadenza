import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MusicItem } from "@apple-musickit";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cadenza.search.recents";
/** How many entries we keep. Past this the oldest fall off the end. */
const MAX_RECENTS = 20;

export type RecentSearch =
    | { kind: "query"; id: string; at: number; text: string }
    | {
          kind: "song";
          id: string;
          at: number;
          songId: string;
          title: string;
          artistName?: string;
          artworkUrl?: string;
      };

function queryId(text: string) {
    return `query:${text.trim().toLowerCase()}`;
}

/**
 * What the user searched and what they opened from the results, newest first.
 * Persisted, because a recents list that empties every launch is worse than no
 * recents list.
 *
 * A song entry stores only the few fields the row draws. A whole cached
 * `MusicItem` would go stale and then lie about ids we would try to play.
 */
export function useRecentSearches() {
    const [recents, setRecents] = useState<RecentSearch[]>([]);
    const [recentsLoading, setRecentsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
            if (cancelled) return;
            if (stored !== null) {
                const restored = parseStoredRecents(stored);
                if (restored) setRecents(restored);
            }
            setRecentsLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Re-recording something moves it to the front rather than duplicating it.
    const record = useCallback((entry: RecentSearch) => {
        setRecents((current) => {
            const next = [
                entry,
                ...current.filter((item) => item.id !== entry.id),
            ].slice(0, MAX_RECENTS);
            void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    }, []);

    const recordQuery = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return;
            record({
                kind: "query",
                id: queryId(trimmed),
                at: Date.now(),
                text: trimmed,
            });
        },
        [record],
    );

    const recordSong = useCallback(
        (song: MusicItem) => {
            record({
                kind: "song",
                id: `song:${song.id}`,
                at: Date.now(),
                songId: song.id,
                title: song.title,
                artistName: song.artistName,
                artworkUrl: song.artworkUrl,
            });
        },
        [record],
    );

    const removeRecent = useCallback((id: string) => {
        setRecents((current) => {
            const next = current.filter((item) => item.id !== id);
            void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    }, []);

    const clearRecents = useCallback(() => {
        setRecents([]);
        void AsyncStorage.removeItem(STORAGE_KEY);
    }, []);

    return {
        recents,
        recentsLoading,
        recordQuery,
        recordSong,
        removeRecent,
        clearRecents,
    };
}

/** Anything we cannot read back as a list of entries is dropped whole. */
function parseStoredRecents(stored: string): RecentSearch[] | null {
    try {
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter(isRecentSearch).slice(0, MAX_RECENTS);
    } catch {
        return null;
    }
}

function isRecentSearch(value: unknown): value is RecentSearch {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Partial<RecentSearch>;
    if (typeof entry.id !== "string" || typeof entry.at !== "number") {
        return false;
    }
    if (entry.kind === "query") return typeof entry.text === "string";
    if (entry.kind === "song") {
        return (
            typeof entry.songId === "string" && typeof entry.title === "string"
        );
    }
    return false;
}
