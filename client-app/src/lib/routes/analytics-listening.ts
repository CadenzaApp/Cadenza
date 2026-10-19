import { useAPIData } from "../api-actions";
import { windowParams, type AnalyticsWindow } from "./analytics";

export type ListeningCell = {
    start: string;
    listening_ms: number;
    plays: number;
};
export type Listening = {
    total_ms: number;
    listening_ms: number;
    plays: number;
    session_count: number;
    cells: ListeningCell[];
};
export type SessionSong = {
    song_id: string;
    listening_ms: number;
    plays: number;
    tags: string[];
};
type Page<T> = { entries: T[]; has_more: boolean };

/**
 * What a listening read's filtered figures count: one tag's songs, songs with
 * none of the user's tags, or everything.
 */
export type ListeningTag = number | "untagged" | null;

function params(window: AnalyticsWindow, tag: ListeningTag) {
    return {
        ...windowParams(window),
        ...(tag === "untagged"
            ? { untagged: true }
            : tag !== null
              ? { tag_id: tag }
              : {}),
    };
}

/**
 * Keeps the last response while a new tag filter loads, so pinning a tag
 * recolors the grid in place. SWR holds that per hook instance, so the caller
 * keys its component by window: another period must never show under new
 * labels.
 */
export function useListening(
    bucket: string,
    window: AnalyticsWindow,
    tag: ListeningTag,
) {
    return useAPIData<Listening>(
        "/analytics/listening",
        { bucket, ...params(window, tag) },
        { save: true, keepPreviousData: true },
    );
}

/**
 * The first `limit` songs listened to in the window, most first played first.
 * Loading more raises the limit rather than paging, so the list stays one key
 * (see the lib README on `useSWRInfinite`). The backend caps it at 100.
 */
export function useListeningSongs(
    window: AnalyticsWindow,
    tag: ListeningTag,
    limit: number,
) {
    return useAPIData<Page<SessionSong>>(
        "/analytics/session-songs",
        { ...params(window, tag), limit },
        // a raised limit keeps the rows it had while the longer list loads
        { save: true, keepPreviousData: true },
    );
}
