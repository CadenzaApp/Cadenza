/**
 * Cache-key matching for backend reads. Kept free of imports so it can be
 * unit tested without pulling in React Native.
 */

export type APIDataEndpoint = {
    path: string;
    params?: Record<string, any>;
};

/**
 * True if an SWR cache key belongs to `endpoint`. Params match as a subset, so
 * `{ path: "/tags" }` covers every cached `/tags` read no matter its params.
 */
export function matchesEndpoint(
    key: unknown,
    endpoint: APIDataEndpoint,
): boolean {
    if (!key || typeof key !== "object") return false;
    const cacheKey = key as {
        keyType?: string;
        path?: string;
        params?: Record<string, any>;
    };
    if (cacheKey.keyType !== "api-data") return false;
    if (cacheKey.path !== endpoint.path) return false;

    const cachedParams = cacheKey.params ?? {};
    const endpointParams = endpoint.params ?? {};

    return Object.keys(endpointParams).every(
        (field) => endpointParams[field] === cachedParams[field],
    );
}
