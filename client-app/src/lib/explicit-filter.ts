/**
 * Drops items Apple rates explicit. Kept free of imports so it can be unit
 * tested without React Native. `use-visible-items.ts` wires it to the user's
 * Hide explicit content setting.
 */

export type MaybeExplicit = { isExplicit?: boolean };

/**
 * `items` without the explicit ones when `hide` is set. Returns `items` itself
 * when nothing is dropped, so a memoized reader does not re-render.
 */
export function withoutExplicit<T extends MaybeExplicit>(
    items: T[],
    hide: boolean,
): T[] {
    if (!hide) return items;
    const kept = items.filter((item) => !item.isExplicit);
    return kept.length === items.length ? items : kept;
}
