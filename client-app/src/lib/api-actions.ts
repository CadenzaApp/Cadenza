import useSWR, { mutate } from "swr";
import useSWRMutation from "swr/mutation";
import { useAccount } from "./account";
import { BACKEND_URL } from "./backend";
import { getAccessToken } from "./supabase";
import { matchesEndpoint, type APIDataEndpoint } from "./api-endpoints";

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
    { method, body }: { method?: string; body?: unknown } = {},
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

    if (!resp.ok) throw data;

    return data as Output;
}

/** Revalidates every cached `api-data` read that matches one of the endpoints */
export function invalidateAPIData(endpoints: APIDataEndpoint[]) {
    mutate((key: unknown) =>
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
) {
    const { account } = useAccount();

    return useSWRMutation(
        [method, path, account?.id],
        async (_: any, { arg: body }: { arg: RequestBody }) => {
            const data = await apiRequest<Response>(BACKEND_URL + path, {
                method,
                body,
            });

            invalidateAPIData(
                Array.isArray(invalidatedEndpoints)
                    ? invalidatedEndpoints
                    : invalidatedEndpoints(body),
            );

            return data;
        },
    );
}

/**
 * Cached idempotent read.
 *
 * `options` is passed through to SWR. `keepPreviousData` is the useful one for
 * a search-as-you-type key, which otherwise drops to undefined on every
 * keystroke.
 */
export function useAPIData<Output>(
    path: string,
    params?: Record<string, any>,
    options?: { keepPreviousData?: boolean },
) {
    const { account } = useAccount();

    // disable this query if any param value is null/undefined
    const enabled =
        Boolean(account) &&
        (!params || !Object.values(params).some((val) => val == null));

    return useSWR(
        enabled
            ? { keyType: "api-data", path, params, accountId: account?.id }
            : null,
        () =>
            apiRequest<Output>(BACKEND_URL + path + queryParamsToStr(params)),
        options,
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
        account
            ? { keyType: "api-data", path, items, accountId: account.id }
            : null,
        async () => {
            const responses = await Promise.all(
                chunk(items, batchSize).map((batch) =>
                    apiRequest<Output>(BACKEND_URL + path, {
                        method: "POST",
                        body: toBody(batch),
                    }),
                ),
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
