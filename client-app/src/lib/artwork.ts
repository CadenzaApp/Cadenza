/** Request player-sized Apple artwork without changing non-Apple image URLs. */
export function playerArtworkUrl(url?: string | null): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith(".mzstatic.com")) return url;
        parsed.pathname = parsed.pathname.replace(
            /\/\d+x\d+([^/]*)$/,
            "/1200x1200$1",
        );
        return parsed.toString();
    } catch {
        return url;
    }
}
