import { isAppleMusicAuthError, isTransientAppleMusicError } from "./app-error";
import {
    getAppleMusicAuthGeneration,
    reportAppleMusicAuthFailure,
} from "./apple-music-auth";
import { withRetry, type RetryPolicy } from "./retry";

/**
 * Up to three retries, about 0.4s, 0.8s, then 1.6s apart. Enough to ride out
 * Apple failing for a moment without leaving a screen loading for long.
 */
const READ_RETRY: RetryPolicy = {
    retries: 3,
    baseDelayMs: 400,
    maxDelayMs: 2_000,
};

/**
 * Runs one Apple Music read, retrying what could work a second time.
 *
 * - Apple failing on its side (5xx), throttling (429), or a dropped
 *   connection: retried with backoff. These used to surface on the first try,
 *   like the 500 Recently Added sometimes gets on opening Library.
 * - Apple rejecting the credentials: retried once. That covers the races a
 *   plain failure cannot tell apart from a dead token, like a read that fired
 *   before the stored token reached the native module. Failing twice reports
 *   it, which tries a silent token refresh and then offers a reconnect.
 * - Anything else, like a 404, throws at once.
 *
 * Every Apple Music read goes through here. A read that skips it gets no
 * retry and hangs on a dead token instead of prompting a reconnect. Only for
 * reads: a write sent twice could happen twice.
 */
export async function readAppleMusic<T>(
    fetchOnce: () => Promise<T>,
): Promise<T> {
    const readGeneration = getAppleMusicAuthGeneration();
    try {
        return await withRetry(fetchOnce, {
            policy: READ_RETRY,
            shouldRetry: (error, retry) =>
                isTransientAppleMusicError(error) ||
                (isAppleMusicAuthError(error) && retry === 0),
        });
    } catch (error) {
        if (isAppleMusicAuthError(error)) {
            reportAppleMusicAuthFailure(readGeneration);
        }
        throw error;
    }
}
