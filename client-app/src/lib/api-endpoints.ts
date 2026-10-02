/**
 * Cache-key matching for backend reads. Kept free of imports so it can be
 * unit tested without pulling in React Native.
 */

export type APIDataEndpoint = {
    path: string;
    params?: Record<string, any>;
    /** Match the complete params object instead of treating params as a subset. */
    exactParams?: boolean;
    /** For batched reads, match only keys whose item list contains this value. */
    item?: unknown;
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
        items?: readonly unknown[];
    };
    if (cacheKey.keyType !== "api-data") return false;
    if (cacheKey.path !== endpoint.path) return false;
    if (
        endpoint.item !== undefined &&
        !cacheKey.items?.some((item) => Object.is(item, endpoint.item))
    ) {
        return false;
    }

    const cachedParams = cacheKey.params ?? {};
    const endpointParams = endpoint.params ?? {};

    if (endpoint.exactParams) {
        const cachedFields = Object.keys(cachedParams);
        const endpointFields = Object.keys(endpointParams);
        if (cachedFields.length !== endpointFields.length) return false;
    }

    return Object.keys(endpointParams).every(
        (field) => endpointParams[field] === cachedParams[field],
    );
}
