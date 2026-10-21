import type { SocialComment, SocialPost } from "@/lib/types";

/** Cache path for one post's comments. */
export function commentsPath(postId: number): string {
    return `/social/posts/${postId}/comments`;
}

/** Cached reads of `GET /social/posts/:id/comments`. */
export function isPostCommentsKey(key: unknown, postId?: number): boolean {
    if (!key || typeof key !== "object") return false;
    const path = (key as { path?: unknown }).path;
    if (typeof path !== "string") return false;
    if (postId != null) return path === commentsPath(postId);
    return /^\/social\/posts\/\d+\/comments$/.test(path);
}

/**
 * Most likes first, then newest, then comment id. Matches the backend.
 */
export function sortCommentsByLikes(
    comments: SocialComment[],
): SocialComment[] {
    return [...comments].sort((a, b) => {
        if (b.likes !== a.likes) return b.likes - a.likes;
        if (a.created_at !== b.created_at) {
            return a.created_at < b.created_at ? 1 : -1;
        }
        return b.comment_id - a.comment_id;
    });
}

type CommentsEnvelope = { comments?: unknown };

/** Sets `liked` on one comment and moves `likes` by one, then re-sorts. */
export function applyCommentLike(
    data: unknown,
    commentId: number,
    liked: boolean,
): unknown {
    if (!data || typeof data !== "object") return data;
    const record = data as CommentsEnvelope;
    if (!Array.isArray(record.comments)) return data;

    let changed = false;
    const comments = record.comments.map((comment) => {
        const updated = adjustComment(comment, commentId, liked);
        if (updated !== comment) changed = true;
        return updated;
    });
    if (!changed) return data;
    return {
        ...record,
        comments: sortCommentsByLikes(comments as SocialComment[]),
    };
}

/**
 * Comments in `pinnedIds` come first, in that order. The rest keep the order
 * they already have. Ids that are not in `comments` are skipped.
 */
export function pinComments(
    comments: SocialComment[],
    pinnedIds: number[],
): SocialComment[] {
    if (pinnedIds.length === 0 || comments.length === 0) return comments;
    const byId = new Map(
        comments.map((comment) => [comment.comment_id, comment]),
    );
    const pinnedSet = new Set<number>();
    const pinned: SocialComment[] = [];
    for (const id of pinnedIds) {
        const comment = byId.get(id);
        if (!comment || pinnedSet.has(id)) continue;
        pinnedSet.add(id);
        pinned.push(comment);
    }
    if (pinned.length === 0) return comments;
    return [
        ...pinned,
        ...comments.filter((comment) => !pinnedSet.has(comment.comment_id)),
    ];
}

/** Inserts a comment into a cached comments list and re-sorts. */
export function insertCachedComment(
    data: unknown,
    comment: SocialComment,
): unknown {
    if (!data || typeof data !== "object") {
        return { comments: [comment] };
    }
    const record = data as CommentsEnvelope;
    const current = Array.isArray(record.comments) ? record.comments : [];
    if (
        current.some(
            (row) =>
                row &&
                typeof row === "object" &&
                (row as SocialComment).comment_id === comment.comment_id,
        )
    ) {
        return data;
    }
    return {
        ...record,
        comments: sortCommentsByLikes([
            ...(current as SocialComment[]),
            comment,
        ]),
    };
}

/**
 * True when `data` is `useSWRInfinite` pages of social posts: a non-empty
 * array of objects that each hold a `feed` or `posts` array of posts.
 * Library and analytics pages do not match, so a cache walk can skip them.
 */
export function isSocialPostPages(data: unknown): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.every(isSocialPostPage);
}

function isSocialPostPage(page: unknown): boolean {
    if (!page || typeof page !== "object" || Array.isArray(page)) return false;
    const record = page as { feed?: unknown; posts?: unknown };
    const rows = Array.isArray(record.feed)
        ? record.feed
        : Array.isArray(record.posts)
          ? record.posts
          : null;
    if (!rows) return false;
    return rows.every(isPostRow);
}

function isPostRow(row: unknown): boolean {
    return (
        !!row &&
        typeof row === "object" &&
        typeof (row as { post_id?: unknown }).post_id === "number"
    );
}

/**
 * Moves `comment_count` on one post inside a cached list. A zero delta
 * leaves the row alone.
 */
export function applyPostCommentDelta(
    data: unknown,
    postId: number,
    delta: number,
): unknown {
    if (delta === 0) return data;
    if (Array.isArray(data)) {
        let changed = false;
        const pages = data.map((page) => {
            const next = applyPostCommentDelta(page, postId, delta);
            if (next !== page) changed = true;
            return next;
        });
        return changed ? pages : data;
    }
    if (!data || typeof data !== "object") return data;

    const record = data as { posts?: unknown; feed?: unknown };
    let changed = false;
    const next: { posts?: unknown; feed?: unknown } = {
        ...(data as object),
    };
    if (Array.isArray(record.posts)) {
        next.posts = record.posts.map((post) => {
            const updated = adjustPostCommentCount(post, postId, delta);
            if (updated !== post) changed = true;
            return updated;
        });
    }
    if (Array.isArray(record.feed)) {
        next.feed = record.feed.map((post) => {
            const updated = adjustPostCommentCount(post, postId, delta);
            if (updated !== post) changed = true;
            return updated;
        });
    }
    return changed ? next : data;
}

function adjustComment(
    comment: unknown,
    commentId: number,
    liked: boolean,
): unknown {
    if (!comment || typeof comment !== "object") return comment;
    const row = comment as SocialComment;
    if (row.comment_id !== commentId || row.liked === liked) return comment;
    return {
        ...row,
        liked,
        likes: Math.max(0, row.likes + (liked ? 1 : -1)),
    };
}

function adjustPostCommentCount(
    post: unknown,
    postId: number,
    delta: number,
): unknown {
    if (!post || typeof post !== "object") return post;
    const row = post as SocialPost;
    if (row.post_id !== postId) return post;
    return {
        ...row,
        comment_count: Math.max(0, (row.comment_count ?? 0) + delta),
    };
}
