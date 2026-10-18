/**
 * Navigation action that closes every screen covering the tabs and opens one
 * user's profile on the Social tab.
 *
 * The profile route is `(tabs)/social/user/[userId]`. `pop` drops the discuss
 * screen, the now playing sheet, and any other root screen above the tabs.
 * `initial: false` keeps the feed under the profile, and the other tabs as
 * they were. Pure, so `open-profile.test.ts` can check the shape.
 */
export function socialProfileNavigateAction(userId: string) {
    return {
        type: "NAVIGATE" as const,
        payload: {
            name: "(tabs)",
            pop: true,
            merge: true,
            params: {
                screen: "social",
                initial: false,
                params: {
                    screen: "user/[userId]",
                    initial: false,
                    params: { userId },
                },
            },
        },
    };
}
