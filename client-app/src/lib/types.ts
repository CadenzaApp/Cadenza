/** What kind of value a tag can hold. Basic tags hold no value at all. */
export type TagType =
    | "basic"
    | "text"
    | "datetime"
    | "date"
    | "number"
    | "checkbox";

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

/**
 * How far to move each tag name's score, keyed by tag name. Positive values
 * raise the score, negative ones lower it. Names are matched case-insensitively
 * and by tag name rather than tag id, so a default tag can be scored too.
 */
export type TagScoreDeltas = Record<string, number>;

/** What each named tag's score is now, keyed by the lowercased tag name. */
export type TagScores = Record<string, number>;

// `GET /tags/scores` has no client caller any more. The Analytics tab reads tags
// by plays in a window instead, which tag_scores cannot answer because it has no
// timestamp. Scores are still written and still decay, as the input for
// recommendations; its response shape lives in backend-api/src/routes/README.md.

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
