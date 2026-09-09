import { useEffect } from "react";
import useSWR, { mutate } from "swr";
import useSWRInfinite from "swr/infinite";
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
 * Cached idempotent POST reads split into stable pages. One page per body, so
 * a caller batches its request payload and gets a page of results back per batch.
 */
export function useAPIPostDataPages<Input, Output>(
    path: string,
    bodies: readonly Input[],
) {
    const { account } = useAccount();
    const pages = useSWRInfinite<Output>(
        (pageIndex) => {
            const body = bodies[pageIndex];
            return body === undefined || !account
                ? null
                : {
                      keyType: "api-data",
                      path,
                      body,
                      accountId: account.id,
                  };
        },
        async ({ body }: { body: Input }) => {
            const resp = await fetch(BACKEND_URL + path, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${account?.jwt}`,
                },
                body: JSON.stringify(body),
            });
            const json = await responseData(resp);

            if (!resp.ok) {
                throw json;
            }

            return json as Output;
        },
    );
    const { setSize, size } = pages;

    useEffect(() => {
        if (bodies.length > 0 && size !== bodies.length) {
            void setSize(bodies.length);
        }
    }, [bodies.length, setSize, size]);

    return pages;
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
            path = BACKEND_URL + path + queryParamsToStr(params);
            const fetchArgs: RequestInit = {
                headers: {
                    Authorization: `Bearer ${account?.jwt}`,
                },
            };

            const resp = await fetch(path, fetchArgs);
            const json = await responseData(resp);

            if (!resp.ok) {
                throw json;
            }

            return json as Output;
        },
    );
}

export { matchesEndpoint, type APIDataEndpoint };
