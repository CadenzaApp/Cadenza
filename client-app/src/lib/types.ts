import type { MetadataKey } from "./query-json";

/** What kind of value a tag can hold. Basic tags hold no value at all. */
export type TagType =
    | "basic"
    | "text"
    | "datetime"
    | "date"
    | "number"
    | "checkbox";

/**
 * One piece of a song's stored Apple Music metadata, from
 * `GET /songs/metadata-tags`. `key` is the key a metadata query filter takes,
 * and `type` says how to read `value`, the same as for an attribute tag.
 */
export type MetadataTag = {
    key: MetadataKey;
    type: TagType;
    value: string;
};

export type Tag = {
    id: number;
    name: string;
    color: string;
    type: TagType;
    /**
     * An activity tag, like "My Plays". Shared by every user, and its value on
     * a song is set by listening rather than by hand.
     */
    is_activity?: boolean;
};

/**
 * A tag as it appears on a song, carrying the value it was applied with.
 * Always null for basic tags, and null for an attribute tag applied without
 * a value.
 */
export type AppliedTag = Tag & {
    value: string | null;
};

export type TagMetadata = {
    count: number;
};

/** What kind of thing the social feed tracks the user's interest in. */
export type InterestType = "artist" | "genre";

/**
 * How far to move the user's interest in one named artist or genre. A positive
 * `delta` raises it, a negative one lowers it.
 */
export type InterestScoreDelta = {
    name: string;
    itype: InterestType;
    delta: number;
};

export type CommentVote = "up" | "down";

/** a comment on a song, as the signed in user sees it */
export type Comment = {
    id: number;
    content: string;
    /** RFC 3339 in UTC, e.g. "2026-09-15T18:03:11.482913Z" */
    created_at: string;
    /** whether the signed in user left it. the backend never says who else did */
    mine: boolean;
    /** up votes minus down votes */
    votes: number;
    /** the signed in user's vote on it */
    my_vote: CommentVote | null;
};

/** a top level comment with its replies, oldest reply first */
export type CommentThread = Comment & {
    replies: Comment[];
};
