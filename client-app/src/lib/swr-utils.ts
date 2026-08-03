import { mutate } from "swr";
import useSWRMutation from "swr/mutation";
import { useAccount } from "./account";
import { BACKEND_URL } from "./backend";

/** invalidate all SWRs */
export function clearCache() {
    mutate(() => true, undefined, { revalidate: false });
}

// useSWRmutation wrapper that invalidates other cache keys that start with the key
export function useMutation<Input, Output>(
    key: string[],
    action: (input: Input) => Promise<Output>,
    options?: object,
) {
    let { isMutating, trigger, error, reset } = useSWRMutation(
        (otherKey: any) => {
            if (!Array.isArray(otherKey)) return false;

            for (let i = 0; i < Math.min(otherKey.length, key.length); i++) {
                if (otherKey[i] !== key[i]) {
                    return false;
                }
            }

            return true;
        },
        async (_, { arg }: { arg: Input }) => {
            return await action(arg);
        },
        options,
    );

    return {
        action: trigger as (input: Input) => Promise<Output>,
        loading: isMutating,
        error,
        reset,
    };
}

export function useAPIAction<Input, Output>(
    key: string[],
    method: string,
    path: string,
) {
    const { account } = useAccount();

    return useMutation<Input, Output>(key, async (body: Input) => {
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

        return json as Output;
    });
}
