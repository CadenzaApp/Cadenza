/**
 * Turns any thrown value into something a screen can render.
 *
 * Nothing in the UI should print a raw error. A native MusicKit failure
 * stringifies to a Swift stack trace, and a backend failure is a bare
 * `{ error_type, message }`. Neither means anything to the person holding the
 * phone. Everything goes through `classifyError` and comes back as an
 * `AppError` with a title, a sentence, and optionally a way out.
 */

/** What went wrong, at the granularity the UI actually branches on. */
export type AppErrorKind =
    | "apple-music-auth"
    | "apple-music-unavailable"
    | "apple-music-api"
    | "session-expired"
    | "not-found"
    | "offline"
    | "unknown";

/** Where the UI sends someone who hit this error. */
export type AppErrorAction = {
    label: string;
    /** An expo-router href. */
    href: string;
};

export type AppError = {
    kind: AppErrorKind;
    /** Short heading. Sentence case, no trailing period. */
    title: string;
    /** One sentence saying what to do about it. */
    detail: string;
    action?: AppErrorAction;
    /** Whether trying the same thing again could plausibly work. */
    retryable: boolean;
    /** The original value, for logging. Never render this. */
    cause: unknown;
};

const RECONNECT_ACTION: AppErrorAction = {
    label: "Open settings",
    href: "/account",
};

/**
 * Native Expo errors carry the thrown Swift/Kotlin exception name in `code`,
 * and repeat it in the message when the cause is chained through
 * `FunctionCallException`.
 */
function nativeErrorName(error: unknown): string | null {
    if (typeof error !== "object" || error === null) return null;

    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("ERR_")) return code;

    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
        const match = message.match(/\b(ERR_[A-Z_]+)\b/);
        if (match) return match[1];
    }
    return null;
}

/** The `error_type` the backend puts on a JSON error body. */
function backendErrorType(error: unknown): string | null {
    if (typeof error !== "object" || error === null) return null;
    const type = (error as { error_type?: unknown }).error_type;
    return typeof type === "string" ? type : null;
}

function isNetworkFailure(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const message = (error as { message?: unknown }).message;
    // what react native's fetch throws when the request never left the device
    return (
        typeof message === "string" && /network request failed/i.test(message)
    );
}

export function classifyError(error: unknown): AppError {
    if (isNetworkFailure(error)) {
        return {
            kind: "offline",
            title: "No connection",
            detail: "Check your network and try again.",
            retryable: true,
            cause: error,
        };
    }

    switch (nativeErrorName(error)) {
        case "ERR_APPLE_MUSIC_AUTH":
        case "ERR_MISSING_USER_TOKEN":
            return {
                kind: "apple-music-auth",
                title: "Apple Music session expired",
                detail: "Reconnect Apple Music to keep using your library.",
                action: RECONNECT_ACTION,
                retryable: false,
                cause: error,
            };
        case "ERR_MISSING_TOKEN":
            return {
                kind: "apple-music-unavailable",
                title: "Apple Music unavailable",
                detail: "This build is missing its Apple Music credentials.",
                retryable: false,
                cause: error,
            };
        case "ERR_APPLE_MUSIC_API":
        case "ERR_INVALID_RESPONSE":
            return {
                kind: "apple-music-api",
                title: "Apple Music is not responding",
                detail: "Something went wrong on Apple's side. Try again in a moment.",
                retryable: true,
                cause: error,
            };
        case "ERR_NOT_FOUND":
            return {
                kind: "not-found",
                title: "Not found",
                detail: "This is no longer in your library.",
                retryable: false,
                cause: error,
            };
        case "ERR_UNSUPPORTED":
            return {
                kind: "apple-music-unavailable",
                title: "Not supported on this device",
                detail: "This needs a newer version of iOS.",
                retryable: false,
                cause: error,
            };
    }

    switch (backendErrorType(error)) {
        case "Unauthorized":
            return {
                kind: "session-expired",
                title: "Signed out",
                detail: "Your session expired. Sign in again to continue.",
                action: { label: "Sign in", href: "/auth?initialMode=signin" },
                retryable: false,
                cause: error,
            };
        case "NotFound":
        case "SongNotInLibrary":
            return {
                kind: "not-found",
                title: "Not found",
                detail: "This is no longer available.",
                retryable: false,
                cause: error,
            };
    }

    return {
        kind: "unknown",
        title: "Something went wrong",
        detail: "Try again in a moment.",
        retryable: true,
        cause: error,
    };
}

/** Whether this error means the Apple Music credentials need replacing. */
export function isAppleMusicAuthError(error: unknown): boolean {
    return classifyError(error).kind === "apple-music-auth";
}
