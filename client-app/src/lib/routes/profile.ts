import { useAPIData, useAPIMutation } from "../api-actions";

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

/** Changes the signed-in user's username and/or bio. */
export function useUpdateProfile() {
    const x = useAPIMutation<UpdateProfilePayload, Profile>(
        "PATCH",
        "/profile",
        [{ path: "/profile" }],
    );
    return {
        updateProfileErr: x.error,
        updateProfileLoading: x.isMutating,
        resetUpdateProfile: x.reset,
        updateProfile: x.trigger,
    };
}
