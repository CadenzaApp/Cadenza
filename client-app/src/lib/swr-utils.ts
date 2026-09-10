import { mutate } from "swr";
import useSWRMutation from "swr/mutation";

/** invalidate all SWRs */
export function clearCache() {
    mutate(() => true, undefined, { revalidate: false });
}

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
