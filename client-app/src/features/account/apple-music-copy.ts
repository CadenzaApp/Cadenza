import { Platform } from "react-native";

import type { SettingsPoint } from "@/features/account/settings-ui";

/** What connecting adds, shown on the onboarding step and the connect sheets. */
export const WHAT_IT_UNLOCKS: SettingsPoint[] = [
    {
        icon: "library-outline",
        title: "Your library",
        body: "Tag the songs, albums, and playlists you already have.",
    },
    {
        icon: "play-circle-outline",
        title: "Full songs",
        body: "Play whole songs with an Apple Music subscription.",
    },
    {
        icon: "list-outline",
        title: "Playlists",
        body: "Save any query back to Apple Music as a playlist.",
    },
];

/** Apple never says which account it is, so say where it comes from. */
export const WHICH_ACCOUNT =
    Platform.OS === "android"
        ? "Uses the account signed in to the Apple Music app. To use a different one, switch it there."
        : "Uses the Apple Music account on this iPhone. To use a different one, switch it in Settings > Media & Purchases.";
