import type { SocialPost } from "./types";

function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Placeholder feed until `/social/feed` is wired. Timestamps are relative to
 * load time so the relative labels stay sensible across sessions.
 */
export const MOCK_FEED: SocialPost[] = [
    {
        post_id: 1,
        author: { username: "maya" },
        content:
            "Tagged half my library as “late night drive” and the query nailed it. Phoebe Bridgers into Japanese Breakfast into Soccer Mommy. Perfect loop.",
        likes: 24,
        created_at: hoursAgo(0.4),
    },
    {
        post_id: 2,
        author: { username: "devon.r" },
        content:
            "Anyone else have a tag for songs that feel like Sunday morning coffee? Mine keeps filling up with soft jazz and unexpected folk cuts.",
        likes: 11,
        created_at: hoursAgo(2),
    },
    {
        post_id: 3,
        author: { username: "aisha" },
        content:
            "Hot take: genre tags are overrated. Mood + energy gets me better playlists every time.",
        likes: 48,
        created_at: hoursAgo(5),
    },
    {
        post_id: 4,
        author: { username: "leo" },
        content:
            "Just hit 100 plays on “Motion Sickness.” It is still not enough.",
        likes: 33,
        created_at: hoursAgo(9),
    },
    {
        post_id: 5,
        author: { username: "priya" },
        content:
            "Built a query: (workout OR hype) AND NOT podcast-energy. Finally a gym playlist that does not derail mid-set.",
        likes: 19,
        created_at: hoursAgo(14),
    },
    {
        post_id: 6,
        author: { username: "sam" },
        content:
            "Sharing my “rainy window” mix. Mostly ambient and slow indie. Drop yours if you have one.",
        likes: 7,
        created_at: hoursAgo(22),
    },
    {
        post_id: 7,
        author: { username: "jordan" },
        content:
            "The suggested tags for my old emo albums were spookily accurate. Cadenza knows me better than I do.",
        likes: 61,
        created_at: hoursAgo(30),
    },
    {
        post_id: 8,
        author: { username: "nina" },
        content:
            "Looking for friends who tag by decade AND vibe. 90s / bittersweet is my current rabbit hole.",
        likes: 15,
        created_at: hoursAgo(40),
    },
];
