/** A full page is useful only if it adds posts that were not already displayed. */
export function feedCanAdvance(
    pages: readonly { feed: readonly { post_id: number }[] }[] | undefined,
    alreadyShown: readonly { post_id: number }[] = [],
): boolean {
    if (!pages?.length) return false;
    const last = pages[pages.length - 1];
    if (last.feed.length < 10) return false;
    const seen = new Set(alreadyShown.map((post) => post.post_id));
    for (const page of pages.slice(0, -1)) {
        for (const post of page.feed) seen.add(post.post_id);
    }
    return last.feed.some((post) => !seen.has(post.post_id));
}
