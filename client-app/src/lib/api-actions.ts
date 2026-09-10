import useSWR, { mutate } from "swr";
import useSWRMutation from "swr/mutation";
import { useAccount } from "./account";
import { BACKEND_URL } from "./backend";

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

type APIDataEndpoint = {
    path: string;
    params?: Record<string, any>;
};

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
        path, // need to put a key here, so just put any random value
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

            mutate((key: any) => {
                if (key.keyType !== "api-data") return false;
                const endpoint = key as APIDataEndpoint;

                for (const invalidEndpoint of endpointsToInvalidate) {
                    if (endpoint.path !== invalidEndpoint.path) continue;

                    const queryParams = endpoint.params ?? {};
                    const invalidParams = invalidEndpoint.params ?? {};

                    // invalidate if invalidParams is subset of queryParams
                    const isInvalid = Object.keys(invalidParams).every(
                        (field) => invalidParams[field] === queryParams[field],
                    );

                    if (isInvalid) return true;
                }

                return false;
            });

            return data as Response;
        },
    );
}

export function useAPIData<Output>(path: string, params?: Record<string, any>) {
    const { account } = useAccount();

    // disable this query if any param value is null/undefined
    const enabled =
        !params || !Object.values(params).some((val) => val == null);

    return useSWR(enabled ? { keyType: "api-data", path, params } : null, async () => {
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
    });
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
