/**
 * Keeps the pushed detail screens (artist, album, playlist, tag, query results)
 * from piling up on the root stack.
 *
 * Opening a detail screen that is already on the stack goes back to it rather
 * than pushing a copy, so artist -> playlist -> the same artist lands on the
 * first one, and tapping the artist you are on does nothing. A fresh one is
 * pushed, and past `MAX_DETAIL_DEPTH` the oldest detail screens are dropped.
 *
 * Pure, so `detail-stack.test.ts` runs it under `node --test`. `useOpenScreen`
 * applies it.
 */

/**
 * The params that make two detail routes the same screen, by root route name.
 * Everything else a route carries (a title, an artwork color) is a hint for
 * drawing before the fetch lands, not part of what it is.
 */
const DETAIL_IDENTITY: Record<string, readonly string[]> = {
    "artist/[id]": ["id"],
    "collection/[kind]/[id]": ["kind", "id"],
    "tag/[tagId]": ["tagId"],
    "query-results": ["query", "suggested"],
};

/** Detail screens kept on the stack at once. */
export const MAX_DETAIL_DEPTH = 5;

/** The part of a navigation route this reads. */
export type StackRoute = {
    key?: string;
    name: string;
    params?: object;
};

type HrefObject = {
    pathname: string;
    params?: object;
};

/**
 * The root route an href opens when it is a detail screen, or null for any
 * other href. Takes a pattern pathname with params (`/artist/[id]`) or a
 * concrete path (`/tag/12`). A string with a query string is not resolved.
 *
 * Params come back as strings, the way the router hands them to a screen.
 */
export function detailRouteFor(href: string | HrefObject): StackRoute | null {
    const { pathname, params = {} } =
        typeof href === "string" ? { pathname: href } : href;
    if (pathname.includes("?")) return null;
    const segments = splitPath(pathname);

    for (const name of Object.keys(DETAIL_IDENTITY)) {
        const bound = matchSegments(splitPath(name), segments, params);
        if (bound) {
            return { name, params: stringParams({ ...params, ...bound }) };
        }
    }
    return null;
}

/** What makes `route` the screen it is, or null when it is not a detail. */
export function detailIdentity(route: StackRoute): string | null {
    const keys = DETAIL_IDENTITY[route.name];
    if (!keys) return null;
    const params = (route.params ?? {}) as Record<string, unknown>;
    return JSON.stringify([
        route.name,
        ...keys.map((key) => String(params[key] ?? "")),
    ]);
}

/**
 * The root stack's routes after opening `target`.
 *
 * Back to the last route with the same identity when there is one, dropping
 * everything above it; that is the same routes when it is already on top.
 * Otherwise `target` on top, with the oldest detail routes dropped so at most
 * `maxDepth` remain.
 */
export function routesAfterOpening<R extends StackRoute>(
    routes: readonly R[],
    target: StackRoute,
    maxDepth = MAX_DETAIL_DEPTH,
): (R | StackRoute)[] {
    const identity = detailIdentity(target);
    const existing = routes.findLastIndex(
        (route) => detailIdentity(route) === identity,
    );
    if (existing >= 0) return routes.slice(0, existing + 1);

    const next: (R | StackRoute)[] = [...routes, target];
    let excess =
        next.filter((route) => detailIdentity(route) !== null).length -
        maxDepth;
    if (excess <= 0) return next;
    return next.filter((route) => {
        if (excess > 0 && detailIdentity(route) !== null) {
            excess -= 1;
            return false;
        }
        return true;
    });
}

function splitPath(path: string): string[] {
    return path.split("/").filter(Boolean);
}

function isDynamic(segment: string): boolean {
    return segment.startsWith("[") && segment.endsWith("]");
}

/**
 * The dynamic segments `pattern` binds in `segments`, or null when the path is
 * a different route. A segment still in brackets takes its value from `params`.
 */
function matchSegments(
    pattern: readonly string[],
    segments: readonly string[],
    params: object,
): Record<string, string> | null {
    if (pattern.length !== segments.length) return null;
    const bound: Record<string, string> = {};
    for (let i = 0; i < pattern.length; i++) {
        const want = pattern[i];
        const got = segments[i];
        if (!isDynamic(want)) {
            if (want !== got) return null;
            continue;
        }
        const key = want.slice(1, -1);
        const value =
            got === want
                ? (params as Record<string, unknown>)[key]
                : decodeURIComponent(got);
        if (value === undefined || value === null || value === "") return null;
        bound[key] = String(value);
    }
    return bound;
}

function stringParams(params: object): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) out[key] = String(value);
    }
    return out;
}
