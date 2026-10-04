import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Whether an artwork url is worth handing to an `Image`.
 *
 * Apple's artwork fields can be absent, blank, or a bare template, and a
 * component that renders one of those shows a broken image rather than its
 * placeholder. Every artwork surface checks this, so it lives here once.
 */
export function isUsableArtworkUrl(url?: string | null): boolean {
    const trimmed = url?.trim();
    return typeof trimmed === "string" && /^https?:\/\//i.test(trimmed);
}
