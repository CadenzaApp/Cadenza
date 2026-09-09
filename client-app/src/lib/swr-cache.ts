import { mutate } from "swr";

export type CachedEndpoint = {
    path: string;
    params?: Record<string, unknown> | "*";
};

export function matchesEndpoint(
    key: unknown,
    endpoint: CachedEndpoint,
): boolean {
    if (!key || typeof key !== "object") return false;
    const cacheKey = key as {
        path?: string;
        params?: Record<string, unknown>;
    };
    if (cacheKey.path !== endpoint.path) return false;
    if (endpoint.params === "*") return true;
    if (!endpoint.params) return cacheKey.params == null;
    if (!cacheKey.params) return false;
    return Object.entries(endpoint.params).every(
        ([name, value]) => cacheKey.params?.[name] === value,
    );
}

/** Clears every cached remote response when the authenticated account changes. */
export function clearCache() {
    mutate(() => true, undefined, { revalidate: false });
}
