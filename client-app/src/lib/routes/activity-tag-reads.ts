import type { APIDataEndpoint } from "../api-endpoints";

/**
 * The reads that hold activity tag values. A write that moves one invalidates
 * these: a play (My Plays and the dates), a favorite (Favorited), a tag put on or
 * taken off a song (Tagged), and a library sync (In My Library).
 */
export const ACTIVITY_TAG_READS: readonly APIDataEndpoint[] = [
    { path: "/songs/activity-tags" },
    { path: "/songs/activity-tags/batch" },
];
