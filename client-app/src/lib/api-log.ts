/**
 * What the app logs when a backend request fails, so a screen that will not
 * load can be traced from the Metro log to the endpoint and the reason.
 *
 * ```text
 * [api] GET /tags -> 401 Unauthorized: Expired signature (84ms)
 * [api] POST /queries/results -> 500 DatabaseError: pool timed out (10012ms)
 * [api] GET /tags -> network error: Network request failed (http://192.168.86.247:3000)
 * ```
 *
 * Pure apart from the `console.warn`, so the formatting is tested in
 * `api-log.test.ts`.
 */

/** The endpoint part of a url: path only, no host and no query. */
export function endpointOf(url: string): string {
    const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "");
    return path.split("?")[0] || "/";
}

/** The origin part of a url, for naming where a network error was headed. */
function originOf(url: string): string {
    return url.match(/^[a-z]+:\/\/[^/]+/i)?.[0] ?? url;
}

/** One line describing a failed request. */
export function describeAPIFailure(
    method: string,
    url: string,
    error: unknown,
    elapsedMs: number,
): string {
    const target = `[api] ${method} ${endpointOf(url)} ->`;

    // fetch itself threw: nothing reached the backend
    if (error instanceof Error) {
        return `${target} network error: ${error.message} (${originOf(url)})`;
    }

    const body = (error ?? {}) as {
        status?: number;
        error_type?: string;
        message?: string;
    };
    const status = body.status != null ? `${body.status} ` : "";
    const kind = body.error_type ?? "error";
    const message = body.message ? `: ${body.message}` : "";
    return `${target} ${status}${kind}${message} (${Math.round(elapsedMs)}ms)`;
}

export function logAPIFailure(
    method: string,
    url: string,
    error: unknown,
    elapsedMs: number,
) {
    console.warn(describeAPIFailure(method, url, error, elapsedMs));
}
