export type PlayerTab = "discuss" | "player" | "tags";

export const PLAYER_TABS: readonly PlayerTab[] = ["discuss", "player", "tags"];

export function tabFromPathname(pathname: string): PlayerTab {
    if (pathname.endsWith("/discuss")) return "discuss";
    if (pathname.endsWith("/tags")) return "tags";
    return "player";
}
