import type { SocialPost } from "@/lib/types";

/** Cached reads that carry `SocialPost` rows. */
export function isSocialPostListKey(key: unknown): boolean {
    if (!key || typeof key !== "object") return false;
    const path = (key as { path?: unknown }).path;
    if (typeof path !== "string") return false;
    return (
        path === "/social/feed" ||
        path === "/social/posts/topic" ||
        path.startsWith("/social/posts/user/")
    );
}

/**
 * Sets `liked` on one post inside a cached list and moves `likes` by one.
 * A second write of the same `liked` value leaves the row alone, so a confirm
 * after the optimistic write does not count twice. Feed pages, topic posts,
 * and an infinite list of those pages all go through here.
 */
export function applyPostLike(
    data: unknown,
    postId: number,
    liked: boolean,
): unknown {
    if (Array.isArray(data)) {
        let changed = false;
        const pages = data.map((page) => {
            const next = applyPostLike(page, postId, liked);
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
            const updated = adjustPost(post, postId, liked);
            if (updated !== post) changed = true;
            return updated;
        });
    }
    if (Array.isArray(record.feed)) {
        next.feed = record.feed.map((post) => {
            const updated = adjustPost(post, postId, liked);
            if (updated !== post) changed = true;
            return updated;
        });
    }
    return changed ? next : data;
}

function adjustPost(post: unknown, postId: number, liked: boolean): unknown {
    if (!post || typeof post !== "object") return post;
    const row = post as SocialPost;
    if (row.post_id !== postId || row.liked === liked) return post;
    return {
        ...row,
        liked,
        likes: Math.max(0, row.likes + (liked ? 1 : -1)),
    };
}
