import { mutate } from "swr";
import useSWRMutation from "swr/mutation";

/** First element of a key that belongs to the device, not the Cadenza account. */
const DEVICE_SCOPE = "device";

/**
 * A key for data about the device's Apple Music session, like its
 * subscription. `clearCache` keeps these, since switching Cadenza accounts
 * does not change the Apple account on the phone.
 */
export function deviceKey(...parts: unknown[]) {
    return [DEVICE_SCOPE, ...parts];
}

function isDeviceKey(key: unknown) {
    return Array.isArray(key) && key[0] === DEVICE_SCOPE;
}

/** Invalidates every SWR read tied to the Cadenza account. */
export function clearCache() {
    mutate((key) => !isDeviceKey(key), undefined, { revalidate: false });
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
