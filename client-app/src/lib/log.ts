/**
 * Logs an error the app already handled: caught, and shown to the person as a
 * clean message or retried. `console.log`, not `console.error`, because a
 * dev build turns every `console.error` into a red overlay, which made a
 * handled Apple Music 500 look like a crash. The details still reach Metro.
 */
export function logHandledError(context: string, error: unknown): void {
    console.log(`[handled] ${context}:`, error);
}
