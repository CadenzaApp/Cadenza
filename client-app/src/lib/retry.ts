/**
 * Retrying a call that can fail for a moment, with backoff. Import-free so it
 * can be unit tested.
 */

export type RetryPolicy = {
    /** Tries after the first one. */
    retries: number;
    /** The wait before the first retry. Each later wait doubles. */
    baseDelayMs: number;
    /** No wait is longer than this. */
    maxDelayMs: number;
};

/**
 * The wait before retry number `retry` (0 is the first retry). Doubles each
 * time up to the cap, then keeps a random 50 to 100 percent of it, so many
 * reads that failed together do not all retry at the same instant.
 */
export function backoffDelay(
    retry: number,
    policy: RetryPolicy,
    random: () => number = Math.random,
): number {
    const full = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** retry);
    return Math.round(full * (0.5 + random() / 2));
}

/**
 * Runs `call`, and again after a backoff while `shouldRetry` says the error
 * is worth another try, up to `policy.retries` more times. Throws the last
 * error once it gives up.
 */
export async function withRetry<T>(
    call: () => Promise<T>,
    {
        policy,
        shouldRetry,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random,
    }: {
        policy: RetryPolicy;
        /** `retry` is how many retries already ran. */
        shouldRetry: (error: unknown, retry: number) => boolean;
        sleep?: (ms: number) => Promise<unknown>;
        random?: () => number;
    },
): Promise<T> {
    for (let retry = 0; ; retry += 1) {
        try {
            return await call();
        } catch (error) {
            if (retry >= policy.retries || !shouldRetry(error, retry)) {
                throw error;
            }
            await sleep(backoffDelay(retry, policy, random));
        }
    }
}
