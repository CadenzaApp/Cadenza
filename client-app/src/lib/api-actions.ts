import useSWR, { mutate } from "swr";
import useSWRMutation from "swr/mutation";
import { useAccount } from "./account";
import { BACKEND_URL } from "./backend";
import { matchesEndpoint, type APIDataEndpoint } from "./api-endpoints";

function queryParamsToStr(params?: Record<string, any>) {
    return !params || Object.keys(params).length === 0
        ? ""
        : "?" + new URLSearchParams(params).toString();
}

/** handles the case when response has no body (doing .json() will fail) */
async function responseData(response: Response) {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
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
            const resp = await fetch(BACKEND_URL + path, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${account?.jwt}`,
                },
                body: JSON.stringify(body),
            });
            const data = await responseData(resp);

            if (!resp.ok) {
                throw data;
            }

            const endpointsToInvalidate = Array.isArray(invalidatedEndpoints)
                ? invalidatedEndpoints
                : invalidatedEndpoints(body);

            mutate((key: unknown) =>
                endpointsToInvalidate.some((endpoint) =>
                    matchesEndpoint(key, endpoint),
                ),
            );

            return data as Response;
        },
    );
}

export function useAPIData<Output>(path: string, params?: Record<string, any>) {
    const { account } = useAccount();

    // disable this query if any param value is null/undefined
    const enabled =
        Boolean(account) &&
        (!params || !Object.values(params).some((val) => val == null));

    return useSWR(
        enabled
            ? { keyType: "api-data", path, params, accountId: account?.id }
            : null,
        async () => {
            const resp = await fetch(
                BACKEND_URL + path + queryParamsToStr(params),
                {
                    headers: {
                        Authorization: `Bearer ${account?.jwt}`,
                    },
                },
            );
            const json = await responseData(resp);

            if (!resp.ok) {
                throw json;
            }

            return json as Output;
        },
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
                chunk(items, batchSize).map(async (batch) => {
                    const resp = await fetch(BACKEND_URL + path, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${account?.jwt}`,
                        },
                        body: JSON.stringify(toBody(batch)),
                    });
                    const json = await responseData(resp);

                    if (!resp.ok) {
                        throw json;
                    }

                    return json as Output;
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
    const { account } = useAccount();

    return useSWRMutation(
        path,
        async (_: any, { arg: params }: { arg: Input }) => {
            // initialize args to fetch() depending on what method is used
            const requestPath = BACKEND_URL + path + queryParamsToStr(params);
            const fetchArgs: RequestInit = {
                headers: {
                    Authorization: `Bearer ${account?.jwt}`,
                },
            };

            const resp = await fetch(requestPath, fetchArgs);
            const json = await responseData(resp);

            if (!resp.ok) {
                throw json;
            }

            return json as Output;
        },
    );
}

export { matchesEndpoint, type APIDataEndpoint };
