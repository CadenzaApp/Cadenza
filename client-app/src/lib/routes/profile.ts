import {
    useAPIData,
    useAPIMutation,
    type APIDataEndpoint,
} from "../api-actions";

export type Profile = {
    uid: string;
    username: string;
    bio: string;
};

/** The signed-in user's profile. */
export function useProfile(enabled = true) {
    const x = useAPIData<Profile>("/profile", undefined, { enabled });

    return {
        profile: x.data,
        profileLoading: x.isLoading,
        profileErr: x.error,
    };
}

/** One count from `GET /profile/data`. */
export type UserDataCount = {
    name: string;
    section: "library" | "tags" | "listening" | "social";
    description: string;
    unit: "count" | "milliseconds";
    value: number;
};

/** A count of everything Cadenza stores about the signed-in user. */
export function useUserData(enabled = true) {
    const x = useAPIData<UserDataCount[]>("/profile/data", undefined, {
        enabled,
    });

    return {
        userData: x.data,
        userDataLoading: x.isLoading,
        userDataErr: x.error,
    };
}

type CreateProfilePayload = {
    username?: string;
    bio?: string;
};

/** Creates the signed-in user's profile. Username defaults on the server. */
export function useCreateProfile() {
    const x = useAPIMutation<CreateProfilePayload | undefined, Profile>(
        "POST",
        "/profile",
        [{ path: "/profile" }],
    );
    return {
        createProfileErr: x.error,
        createProfileLoading: x.isMutating,
        resetCreateProfile: x.reset,
        createProfile: x.trigger,
    };
}

type UpdateProfilePayload = {
    username?: string;
    bio?: string;
};

/**
 * Changes the signed-in user's username and/or bio.
 * Always refreshes `GET /profile`. Pass any other reads that show the name,
 * such as the public page at `/social/posts/user/:id`.
 */
export function useUpdateProfile(alsoInvalidate: APIDataEndpoint[] = []) {
    const x = useAPIMutation<UpdateProfilePayload, Profile>(
        "PATCH",
        "/profile",
        [{ path: "/profile" }, ...alsoInvalidate],
    );
    return {
        updateProfileErr: x.error,
        updateProfileLoading: x.isMutating,
        resetUpdateProfile: x.reset,
        updateProfile: x.trigger,
    };
}
