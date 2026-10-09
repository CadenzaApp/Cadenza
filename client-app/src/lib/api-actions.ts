import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import useSWRMutation from "swr/mutation";
import { useAccount } from "./account";
import { BACKEND_URL } from "./backend";
import { getAccessToken } from "./supabase";
import { matchesEndpoint, type APIDataEndpoint } from "./api-endpoints";
import { logAPIFailure } from "./api-log";

type BatchedReadCacheEntry = {
    path: string;
    items: readonly unknown[];
    response: Promise<unknown>;
};

// SWR caches the merged result for each caller. This smaller read-through
// cache preserves completed transport chunks when a paginated caller appends
// more ids and therefore changes its merged SWR key.
const batchedReadCache = new Map<string, BatchedReadCacheEntry>();
const MAX_BATCHED_READ_CACHE_ENTRIES = 256;

function queryParamsToStr(params?: Record<string, any>) {
    return !params || Object.keys(params).length === 0
        ? ""
        : "?" + new URLSearchParams(params).toString();
}

/** What every wrapper throws when the response body is not the backend's JSON. */
export type APIRequestError = {
    error_type: "Unauthorized" | "HttpError" | "MalformedResponse";
    status: number;
    message: string;
};

/**
 * One backend request. Attaches a fresh access token, tolerates an empty or
 * non-JSON body, and throws the error body on a non-2xx.
 *
 * The token comes from `getAccessToken()` per call rather than from the account
 * context, because the context holds whatever token sign in returned and that
 * one expires after about an hour.
 */
async function apiRequest<Output>(
    url: string,
    options: { method?: string; body?: unknown } = {},
): Promise<Output> {
    const started = Date.now();
    try {
        return await sendAPIRequest<Output>(url, options);
    } catch (error) {
        // SWR keeps a failed read's error to itself, so without this a screen
        // that will not load leaves nothing in the Metro log
        logAPIFailure(
            options.method ?? "GET",
            url,
            error,
            Date.now() - started,
        );
        throw error;
    }
}

async function sendAPIRequest<Output>(
    url: string,
    { method, body }: { method?: string; body?: unknown },
): Promise<Output> {
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const resp = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await resp.text();
    let data: unknown = {};
    let isJSON = true;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            isJSON = false;
        }
    }

    // a 401 from the auth layer is plain text ("Expired signature"), and so is
    // anything a proxy puts in front of us, so neither can be parsed as the
    // backend's { error_type, message }
    if (!isJSON) {
        const error: APIRequestError = {
            error_type: resp.ok
                ? "MalformedResponse"
                : resp.status === 401
                  ? "Unauthorized"
                  : "HttpError",
            status: resp.status,
            message: text,
        };
        throw error;
    }

    if (!resp.ok) {
        // the backend's body names the error but not the status
        throw data && typeof data === "object"
            ? { status: resp.status, ...data }
            : data;
    }

    return data as Output;
}

/** Revalidates every cached `api-data` read that matches one of the endpoints */
export function invalidateAPIData(endpoints: APIDataEndpoint[]) {
    for (const [key, entry] of batchedReadCache) {
        if (
            endpoints.some(
                (endpoint) =>
                    endpoint.path === entry.path &&
                    (endpoint.item === undefined ||
                        entry.items.some((item) =>
                            Object.is(item, endpoint.item),
                        )),
            )
        ) {
            batchedReadCache.delete(key);
        }
    }
    return mutate((key: unknown) =>
        endpoints.some((endpoint) => matchesEndpoint(key, endpoint)),
    );
}

/** When triggered, invalidates `useAPIData`s using the given endpoints */
export function useAPIMutation<RequestBody, Response>(
    method: string,
    path: string,
    invalidatedEndpoints:
        | ((body: RequestBody) => APIDataEndpoint[])
        | APIDataEndpoint[] = [],
    options?: {
        /**
         * Background is the responsive default. Use await only when the caller
         * cannot proceed until fresh reads arrive, or none when a coordinator
         * will invalidate once after several related writes.
         */
        invalidation?: "background" | "await" | "none";
        /** @deprecated Prefer `invalidation: "await"`. */
        awaitInvalidation?: boolean;
    },
) {
    const { account } = useAccount();

    return useSWRMutation(
        [method, path, account?.id],
        async (_: any, { arg: body }: { arg: RequestBody }) => {
            const data = await apiRequest<Response>(BACKEND_URL + path, {
                method,
                body,
            });

            const invalidationMode =
                options?.invalidation ??
                (options?.awaitInvalidation ? "await" : "background");
            if (invalidationMode !== "none") {
                const invalidation = invalidateAPIData(
                    Array.isArray(invalidatedEndpoints)
                        ? invalidatedEndpoints
                        : invalidatedEndpoints(body),
                );
                if (invalidationMode === "await") {
                    await invalidation;
                } else {
                    void invalidation.catch((error) =>
                        console.error("API cache refresh failed", error),
                    );
                }
            }

            return data;
        },
    );
}

/**
 * Cached idempotent read.
 *
 * `keepPreviousData` keeps old results visible for a search-as-you-type key.
 * `enabled: false` leaves the SWR key dormant without changing hook order.
 */
export function useAPIData<Output>(
    path: string,
    params?: Record<string, any>,
    options?: {
        keepPreviousData?: boolean;
        enabled?: boolean;
        /** Called after each successful fetch, not on a cache hit. */
        onSuccess?: (data: Output) => void;
    },
) {
    const { account } = useAccount();

    // disable this query if any param value is null/undefined
    const enabled =
        (options?.enabled ?? true) &&
        Boolean(account) &&
        (!params || !Object.values(params).some((val) => val == null));

    return useSWR(
        enabled
            ? { keyType: "api-data", path, params, accountId: account?.id }
            : null,
        () => apiRequest<Output>(BACKEND_URL + path + queryParamsToStr(params)),
        {
            keepPreviousData: options?.keepPreviousData,
            // SWR merges config with a spread, so an explicit undefined would
            // replace its default no-op and every fetch would throw calling it
            ...(options?.onSuccess ? { onSuccess: options.onSuccess } : {}),
        },
    );
}

/** Cached idempotent read that uses POST because its request body may be large. */
export function useAPIPostData<Body, Output>(path: string, body: Body | null) {
    const { account } = useAccount();

    return useSWR(
        account && body !== null
            ? {
                  keyType: "api-data",
                  method: "POST",
                  path,
                  body,
                  accountId: account.id,
              }
            : null,
        () =>
            apiRequest<Output>(BACKEND_URL + path, {
                method: "POST",
                body,
            }),
        { keepPreviousData: false },
    );
}

/** How long `useAPIPostSnapshot` waits before each retry of a failed read. */
const SNAPSHOT_RETRY_DELAYS_MS = [1000, 3000] as const;

/**
 * A POST read fetched once and then held for as long as the caller stays
 * mounted. It is never revalidated: not on focus, not on reconnect, and not when
 * a mutation invalidates its path. For a long list the user scrolls through,
 * where a refresh in the background would move rows out from under them. A new
 * `body` fetches again.
 *
 * Deliberately not SWR. Each mounted caller needs its own answer, and SWR's
 * shared cache would hand a newly opened screen the answer an earlier one got,
 * and keep every screen's answer after it closed.
 */
export function useAPIPostSnapshot<Body, Output>(
    path: string,
    body: Body | null,
) {
    const { account } = useAccount();
    // the body as a string, so an equal body in a new object does not refetch
    const requestKey =
        account && body !== null
            ? JSON.stringify([account.id, path, body])
            : null;
    const [result, setResult] = useState<{
        requestKey: string;
        data?: Output;
        error?: unknown;
    } | null>(null);

    useEffect(() => {
        if (requestKey === null) return;
        let cancelled = false;
        const [, requestPath, requestBody] = JSON.parse(requestKey) as [
            string,
            string,
            Body,
        ];

        // SWR would retry a failed read, so this does too, a few times with
        // a growing wait, before it gives up and reports the error
        async function load(key: string) {
            for (let attempt = 0; ; attempt += 1) {
                try {
                    const data = await apiRequest<Output>(
                        BACKEND_URL + requestPath,
                        { method: "POST", body: requestBody },
                    );
                    if (!cancelled) setResult({ requestKey: key, data });
                    return;
                } catch (error) {
                    if (cancelled) return;
                    if (attempt >= SNAPSHOT_RETRY_DELAYS_MS.length) {
                        setResult({ requestKey: key, error });
                        return;
                    }
                    await new Promise((resolve) =>
                        setTimeout(resolve, SNAPSHOT_RETRY_DELAYS_MS[attempt]),
                    );
                    if (cancelled) return;
                }
            }
        }
        void load(requestKey);

        return () => {
            cancelled = true;
        };
    }, [requestKey]);

    // an answer to an earlier body is not an answer to this one
    const current = result?.requestKey === requestKey ? result : null;
    return {
        data: current?.data,
        error: current?.error,
        isLoading: requestKey !== null && current === null,
    };
}

/**
 * Cached idempotent read whose request payload is a list too long for a query
 * string. The list is split into batches that run in parallel and are merged
 * back together, but the whole read is one `api-data` key, so `useAPIMutation`
 * invalidates it like any other read.
 */
export function useAPIPostDataBatched<Item, Body, Output>(
    path: string,
    items: readonly Item[],
    {
        batchSize,
        toBody,
        merge,
    }: {
        batchSize: number;
        toBody: (batch: Item[]) => Body;
        merge: (responses: Output[]) => Output;
    },
) {
    const { account } = useAccount();

    return useSWR(
        account && items.length > 0
            ? { keyType: "api-data", path, items, accountId: account.id }
            : null,
        async () => {
            const responses = await Promise.all(
                chunk(items, batchSize).map((batch) => {
                    const cacheKey = JSON.stringify([account!.id, path, batch]);
                    const cached = batchedReadCache.get(cacheKey);
                    if (cached) return cached.response as Promise<Output>;

                    const response = apiRequest<Output>(BACKEND_URL + path, {
                        method: "POST",
                        body: toBody(batch),
                    }).catch((error) => {
                        batchedReadCache.delete(cacheKey);
                        throw error;
                    });
                    batchedReadCache.set(cacheKey, {
                        path,
                        items: batch,
                        response,
                    });
                    while (
                        batchedReadCache.size > MAX_BATCHED_READ_CACHE_ENTRIES
                    ) {
                        const oldestKey = batchedReadCache.keys().next().value;
                        if (oldestKey === undefined) break;
                        batchedReadCache.delete(oldestKey);
                    }
                    return response;
                }),
            );

            return merge(responses);
        },
        // the id list grows as a screen pages in, so hold the last result
        // rather than flashing empty on every new page
        { keepPreviousData: true },
    );
}

function chunk<T>(values: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

/** GET/POST requests that only run upon triggered */
export function useAPIFetch<Input extends Record<string, any>, Output>(
    path: string,
) {
    return useSWRMutation(path, (_: any, { arg: params }: { arg: Input }) =>
        apiRequest<Output>(BACKEND_URL + path + queryParamsToStr(params)),
    );
}

export { matchesEndpoint, type APIDataEndpoint };
