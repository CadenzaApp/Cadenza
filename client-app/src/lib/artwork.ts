/** Request player-sized Apple artwork without changing non-Apple image URLs. */
export function playerArtworkUrl(url?: string | null): string | undefined {
    return appleArtworkUrl(url, 1200);
}

/** Bandwidth-saving variant for small artwork in music lists. */
export function thumbnailArtworkUrl(url?: string | null): string | undefined {
    return appleArtworkUrl(url, 200);
}

function appleArtworkUrl(
    url: string | null | undefined,
    size: number,
): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith(".mzstatic.com")) return url;
        parsed.pathname = parsed.pathname.replace(
            /\/\d+x\d+([^/]*)$/,
            `/${size}x${size}$1`,
        );
        return parsed.toString();
    } catch {
        return url;
    }
}
