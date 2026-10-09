/**
 * Which saved reads to keep. Split from `saved-reads-store.ts` so it stays
 * import-free and testable under `node --test`.
 */

/** How many reads are kept on the device before the oldest is dropped. */
export const SAVED_READS_CAP = 40;

/**
 * Moves `key` to the front of `index`, newest first, and trims it to `cap`.
 * Returns the new index and the keys that fell off the end.
 */
export function touchSavedRead(
    index: readonly string[],
    key: string,
    cap = SAVED_READS_CAP,
): { index: string[]; evicted: string[] } {
    const next = [key, ...index.filter((saved) => saved !== key)];
    return { index: next.slice(0, cap), evicted: next.slice(cap) };
}
