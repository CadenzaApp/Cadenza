import useSWR, { mutate } from "swr";
import useSWRMutation from "swr/mutation";
import { useAccount } from "./account";
import { BACKEND_URL } from "./backend";

/** invalidate all SWRs */
export function clearCache() {
    mutate(() => true, undefined, { revalidate: false });
}

/** Simplified wrapper around `useSWRMutation`.
 * Triggering this mutation invalidates many keys (not just one) */
function useMultiKeyMutation<Input, Output>(
    action: (input: Input) => Promise<Output>,
    keys: any[],
    options?: any,
) {
    let { isMutating, trigger, error, reset } = useSWRMutation(
        keys[0], // need to put a key here, so just put a dummy value
        async (_: any, { arg }: { arg: Input }) => {
            const result = await action(arg);
            mutate((key: any) => keys.includes(key), undefined, {
                revalidate: true,
            });
            return result;
        },
        options,
    );

    return {
        trigger: trigger as (input: Input) => Promise<Output>,
        isMutating,
        error,
        reset,
    };
}

function queryParamsToStr(params?: Record<string, any>) {
    return params && Object.keys(params).length === 0
        ? ""
        : "?" + new URLSearchParams(params).toString();
}

/** When triggered, invalidates this path and optionally other paths too */
export function useAPIMutation<RequestBody, Response>(
    method: string,
    path: string,
    additionalInvalidatedPaths: string[] = [],
) {
    const { account } = useAccount();

    return useMultiKeyMutation<RequestBody, Response>(
        async (body: RequestBody) => {
            const resp = await fetch(BACKEND_URL + path, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${account?.jwt}`,
                },
                body: JSON.stringify(body),
            });
            const json = resp.json();

            if (!resp.ok) {
                throw json;
            }

            return json as Response;
        },
        [path, ...additionalInvalidatedPaths],
    );
}

export function useAPIData<Output>(
    path: string,
    params?: Record<string, any>,
) {
    const { account } = useAccount();

    return useSWR(path, async () => {
        const resp = await fetch(
            BACKEND_URL + path + queryParamsToStr(params),
            {
                headers: {
                    Authorization: `Bearer ${account?.jwt}`,
                },
            },
        );
        const json = resp.json();

        if (!resp.ok) {
            throw json;
        }

        return json as Output;
    });
}

/** GET requests with query params, but only run upon triggered */
export function useAPIFetch<QueryParams extends Record<string, any>, Output>(
    path: string,
    params?: QueryParams,
) {
    const { account } = useAccount();

    return useSWRMutation(path, async () => {
        const resp = await fetch(
            BACKEND_URL + path + queryParamsToStr(params),
            {
                headers: {
                    Authorization: `Bearer ${account?.jwt}`,
                },
            },
        );
        const json = resp.json();

        if (!resp.ok) {
            throw json;
        }

        return json as Output;
    });
}
