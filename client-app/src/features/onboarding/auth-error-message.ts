/**
 * The line the login form shows for a failed sign in or sign up. Supabase
 * errors carry a `code`; the ones a person can act on get their own sentence,
 * the rest fall back to Supabase's message, which is already plain English.
 */

const BY_CODE: Record<string, string> = {
    invalid_credentials: "Wrong email or password.",
    user_already_exists:
        "An account with this email already exists. Sign in instead.",
    email_exists: "An account with this email already exists. Sign in instead.",
    email_not_confirmed:
        "Confirm your email first. Check your inbox for the link.",
    email_address_invalid: "That email address does not look right.",
    validation_failed: "Enter an email and a password.",
    over_request_rate_limit: "Too many tries. Wait a minute and try again.",
    over_email_send_rate_limit:
        "Too many emails sent. Wait a minute and try again.",
    signup_disabled: "New accounts are turned off right now.",
};

const FALLBACK = "Could not sign in. Try again in a moment.";

export function authErrorMessage(error: unknown): string {
    if (typeof error !== "object" || error === null) return FALLBACK;
    const { code, message, name } = error as {
        code?: unknown;
        message?: unknown;
        name?: unknown;
    };

    if (
        typeof message === "string" &&
        /network request failed/i.test(message)
    ) {
        return "No connection. Check your network and try again.";
    }
    if (typeof code === "string" && code in BY_CODE) return BY_CODE[code];
    // weak_password and friends say what is wrong in the message itself
    if (
        typeof name === "string" &&
        name.startsWith("Auth") &&
        typeof message === "string" &&
        message.length > 0
    ) {
        return message;
    }
    return FALLBACK;
}
