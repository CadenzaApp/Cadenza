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

function params(window: AnalyticsWindow, tagId: number | null) {
    return {
        ...windowParams(window),
        ...(tagId !== null ? { tag_id: tagId } : {}),
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
    tagId: number | null,
) {
    return useAPIData<Listening>(
        "/analytics/listening",
        { bucket, ...params(window, tagId) },
        { save: true, keepPreviousData: true },
    );
}

/**
 * The first `limit` songs listened to in the window, most first played first.
 * "Show more" raises the limit rather than paging, so the list stays one key
 * (see the lib README on `useSWRInfinite`). The backend caps it at 100.
 */
export function useListeningSongs(
    window: AnalyticsWindow,
    tagId: number | null,
    limit: number,
) {
    return useAPIData<Page<SessionSong>>(
        "/analytics/session-songs",
        { ...params(window, tagId), limit },
        // a raised limit keeps the rows it had while the longer list loads
        { save: true, keepPreviousData: true },
    );
}
