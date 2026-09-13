// On a physical device "localhost" is the phone, not this mac, so the url has
// to come from the environment. .personal/dev.sh already checks that
// EXPO_PUBLIC_BACKEND_API_URL matches the current LAN ip on every start.
// Metro inlines EXPO_PUBLIC_* at bundle time, so changing .env needs a metro
// restart with --clear (./dev.sh reload), not just a refresh.
const CONFIGURED_URL = process.env.EXPO_PUBLIC_BACKEND_API_URL?.trim();

export const BACKEND_URL = (CONFIGURED_URL || "http://localhost:3000").replace(
    /\/+$/,
    "",
);
