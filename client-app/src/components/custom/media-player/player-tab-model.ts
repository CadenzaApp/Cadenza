export type PlayerTab = "comments" | "player" | "tags";

export const PLAYER_TABS: readonly PlayerTab[] = ["comments", "player", "tags"];

export function tabFromPathname(pathname: string): PlayerTab {
    if (pathname.endsWith("/comments")) return "comments";
    if (pathname.endsWith("/tags")) return "tags";
    return "player";
}
