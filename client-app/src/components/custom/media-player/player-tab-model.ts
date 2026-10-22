export type PlayerTab = "discuss" | "player" | "tags";

export const PLAYER_TABS: readonly PlayerTab[] = ["discuss", "player", "tags"];

export function tabFromPathname(pathname: string): PlayerTab {
    if (pathname.endsWith("/discuss")) return "discuss";
    if (pathname.endsWith("/tags")) return "tags";
    return "player";
}

/** Covering Now Playing with a detail route must not remount its providers. */
export function playerLayoutKey(pathname: string, previous = "/player") {
    return pathname === "/player" || pathname.startsWith("/player/")
        ? pathname
        : previous;
}
