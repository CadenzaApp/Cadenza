import { mutate } from "swr";

/** Clears every cached remote response when the authenticated account changes. */
export function clearCache() {
    mutate(() => true, undefined, { revalidate: false });
}
