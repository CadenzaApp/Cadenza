import { ACTIVITY_TAG_READS } from "./activity-tag-reads";
import { ANALYTICS_READS } from "./analytics-reads";

import { useAPIMutation } from "../api-actions";
import type { QueuedEvent } from "../event-queue";

export type RecordEventsPayload = {
    events: QueuedEvent[];
};

export type RecordEventsResponse = {
    /**
     * Every `client_event_id` now stored, including ones an earlier attempt
     * stored. Exactly what the queue may drop.
     */
    accepted: string[];
};

/**
 * `POST /events`. Sends a batch of listening events.
 *
 * Idempotent on `client_event_id`, so a retry after a timeout is free and the
 * caller never has to decide whether a failed request got through.
 *
 * Only a batch holding a `play_counted` invalidates the metadata tag reads,
 * because that is the only event that moves Total Plays. It and a favorite are
 * the events that move an activity tag (My Plays, First Played, Last Played,
 * Favorited), so either invalidates the activity tag reads and the query
 * results. Every event
 * changes the analytics, so those reads are always invalidated. Without that split a scrub through one song would refetch
 * the activity tags for the whole visible library once per seek.
 */
export function useRecordEvents() {
    const x = useAPIMutation<RecordEventsPayload, RecordEventsResponse>(
        "POST",
        "/events",
        ({ events }) => {
            // every analytics read, or a play leaves the detail pages stale
            const analytics = [...ANALYTICS_READS];
            const played = events.some(
                (event) => event.type === "play_counted",
            );
            const favorited = events.some(
                (event) =>
                    event.type === "song_favorited" ||
                    event.type === "song_unfavorited",
            );
            if (!played && !favorited) return analytics;
            return [
                ...analytics,
                ...ACTIVITY_TAG_READS,
                // Total Plays moves in the same transaction as My Plays
                ...(played ? [{ path: "/songs/metadata-tags" }] : []),
                { path: "/queries/results" },
            ];
        },
        { invalidation: "background" },
    );
    return {
        recordEventsErr: x.error,
        recordEventsLoading: x.isMutating,
        recordEvents: x.trigger,
    };
}
