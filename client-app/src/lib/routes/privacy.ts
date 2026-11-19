import { useAPIData, useAPIMutation } from "../api-actions";

/** Who can see one part of a user's listening. */
export type Audience = "everyone" | "friends" | "nobody";

/** From `GET /settings/privacy`. */
export type PrivacySettings = {
    /** The song playing right now. */
    now_playing: Audience;
    /** Recent plays on the profile. */
    listening_history: Audience;
    /** Who can join a live session without a code. */
    session_join: Audience;
    /** Who can add this user to a shared playlist without a code. */
    playlist_add: Audience;
    /**
     * Who can join the session the phone opens whenever this user plays.
     * `nobody` means listen along is off.
     */
    listen_along: Audience;
    /** Shared playlists on the profile. */
    profile_playlists: Audience;
    /** Saved queries shared on the profile. */
    profile_queries: Audience;
};

/** What the backend returns for a user who never changed one. */
export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
    now_playing: "friends",
    listening_history: "friends",
    session_join: "friends",
    playlist_add: "friends",
    listen_along: "nobody",
    profile_playlists: "friends",
    profile_queries: "friends",
};

/**
 * The signed-in user's privacy settings. `updatePrivacy` applies a change at
 * once and rolls it back if the PATCH fails.
 */
export function usePrivacySettings() {
    const x = useAPIData<PrivacySettings>("/settings/privacy");
    const patch = useAPIMutation<Partial<PrivacySettings>, PrivacySettings>(
        "PATCH",
        "/settings/privacy",
        [],
        { invalidation: "none" },
    );

    const privacy = x.data ?? DEFAULT_PRIVACY_SETTINGS;

    function updatePrivacy(change: Partial<PrivacySettings>) {
        // the PATCH returns the whole row, so no GET after it
        return x.mutate(patch.trigger(change), {
            optimisticData: (current) => ({
                ...(current ?? privacy),
                ...change,
            }),
            rollbackOnError: true,
            populateCache: true,
            revalidate: false,
        });
    }

    return {
        privacy,
        privacyLoading: x.isLoading,
        privacyErr: x.error,
        updatePrivacy,
        updatePrivacyErr: patch.error,
    };
}
