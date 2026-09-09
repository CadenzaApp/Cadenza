import { useEffect } from "react";
import useSWR, { mutate } from "swr";
import useSWRInfinite from "swr/infinite";
import useSWRMutation from "swr/mutation";
import { useAccount } from "./account";
import { BACKEND_URL } from "./backend";
import { matchesEndpoint, type CachedEndpoint } from "./swr-cache";

/** Simplified wrapper around `useSWRMutation` with Input/Output types */
export function useSimpleMutation<Input, Output>(
    key: any,
    action: (input: Input) => Promise<Output>,
) {
    let { data, isMutating, trigger, error, reset } = useSWRMutation(
        key,
        async (_: any, { arg }: { arg: Input }) => {
            const result = await action(arg);
            return result;
        },
    );

    return {
        data,
        trigger: trigger as (input: Input) => Promise<Output>,
        isMutating,
        error,
        reset,
    };
}

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

/** When triggered, invalidates the GET endpoint that matches this path, and optionally other GET endpoints too. */
export function useAPIMutation<RequestBody, Response>(
    method: string,
    path: string,
    invalidatedEndpoints:
        | ((body: RequestBody) => CachedEndpoint[])
        | CachedEndpoint[] = [],
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

            const configuredEndpoints = Array.isArray(invalidatedEndpoints)
                ? invalidatedEndpoints
                : invalidatedEndpoints(body);
            const endpointsToInvalidate = [...configuredEndpoints, { path }];

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
        enabled ? { path, params, accountId: account?.id } : null,
        async () => {
            const resp = await fetch(
                BACKEND_URL + path + queryParamsToStr(params),
                {
                    headers: {
                        Authorization: `Bearer ${account?.jwt}`,
                        Accept: "*/*",
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

/** Cached idempotent read whose request payload is too large for a query string. */
export function useAPIPostData<Input, Output>(path: string, body?: Input) {
    const { account } = useAccount();

    return useSWR(
        body === undefined || !account
            ? null
            : { path, body, accountId: account?.id, readMethod: "POST" },
        async () => {
            const resp = await fetch(BACKEND_URL + path, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${account?.jwt}`,
                },
                body: JSON.stringify(body),
            });
            const json = await responseData(resp);
            if (!resp.ok) throw json;
            return json as Output;
        },
    );
}

/** Cached idempotent POST reads split into stable pages. */
export function useAPIPostDataPages<Input, Output>(
    path: string,
    bodies: readonly Input[],
) {
    const { account } = useAccount();
    const x = useSWRInfinite<Output>(
        (pageIndex) => {
            const body = bodies[pageIndex];
            return body === undefined || !account
                ? null
                : { path, body, accountId: account.id, readMethod: "POST" };
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
            if (!resp.ok) throw json;
            return json as Output;
        },
    );
    const { setSize, size } = x;

    useEffect(() => {
        if (bodies.length > 0 && size !== bodies.length) {
            void setSize(bodies.length);
        }
    }, [bodies.length, setSize, size]);

    return x;
}

/** GET/POST requests that only run upon triggered */
export function useAPIFetch<Input extends Record<string, any>, Output>(
    path: string,
    method: "GET" | "POST" = "GET",
) {
    const { account } = useAccount();

    return useSWRMutation(
        path,
        async (_: any, { arg: paramsOrBody }: { arg: Input }) => {
            // initialize args to fetch() depending on what method is used
            let requestPath = BACKEND_URL + path;
            const fetchArgs: RequestInit = {
                method,
                headers: {
                    Authorization: `Bearer ${account?.jwt}`,
                },
            };
            if (method === "GET") {
                requestPath += queryParamsToStr(paramsOrBody);
            } else {
                (fetchArgs.headers as any)["Content-Type"] = "application/json";
                fetchArgs.body = JSON.stringify(paramsOrBody);
            }

            const resp = await fetch(requestPath, fetchArgs);
            const json = await responseData(resp);

            if (!resp.ok) {
                throw json;
            }

            return json as Output;
        },
    );
}
