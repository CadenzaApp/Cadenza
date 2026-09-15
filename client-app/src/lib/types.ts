export type Tag = {
    id: number;
    name: string;
    color: string;
};

export type TagMetadata = {
    count: number;
}

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
