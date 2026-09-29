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

/**
 * Where a top tag's color came from: `local` if the user has a tag of that
 * name, `global` if only a default tag does.
 */
export type TagSource = "local" | "global";

/** One of the user's top tags as `GET /tags/scores` sends it. */
export type ScoredTag = [score: number, color: string, source: TagSource];

/** The user's top tags, keyed by the lowercased tag name, in no order. */
export type TopTagScores = Record<string, ScoredTag>;

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
