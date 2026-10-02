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
 * Only a batch holding a `play_counted` invalidates the activity tag reads and
 * the query results, because that is the only event that moves My Plays, First
 * Played, or Last Played. Every event changes the analytics, so those reads are
 * always invalidated. Without that split a scrub through one song would refetch
 * the activity tags for the whole visible library once per seek.
 */
export function useRecordEvents() {
    const x = useAPIMutation<RecordEventsPayload, RecordEventsResponse>(
        "POST",
        "/events",
        ({ events }) => {
            const analytics = [
                { path: "/analytics/summary" },
                { path: "/analytics/trends" },
            ];
            const movedActivityTags = events.some(
                (event) => event.type === "play_counted",
            );
            if (!movedActivityTags) return analytics;
            return [
                ...analytics,
                { path: "/songs/activity-tags" },
                { path: "/songs/activity-tags/batch" },
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
