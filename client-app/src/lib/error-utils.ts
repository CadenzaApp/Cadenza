export type ErrorDetails = {
    message: string;
    name?: string;
    code?: unknown;
    nativeStackIOS?: unknown;
    cause?: unknown;
};

export function getErrorDetails(error: unknown): ErrorDetails {
    if (error instanceof Error) {
        const nativeError = error as Error & {
            code?: unknown;
            nativeStackIOS?: unknown;
        };
        return {
            message: error.message,
            name: error.name,
            code: nativeError.code,
            nativeStackIOS: nativeError.nativeStackIOS,
            cause: error.cause,
        };
    }

    if (typeof error === "object" && error !== null && "message" in error) {
        return {
            ...(error as Record<string, unknown>),
            message: String((error as { message: unknown }).message),
        };
    }

    return { message: String(error) };
}

export function getErrorMessage(error: unknown) {
    return getErrorDetails(error).message || "Unknown error";
}
