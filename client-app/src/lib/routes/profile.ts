import { useAPIData, useAPIMutation } from "../api-actions";
import { BACKEND_URL } from "../backend";

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

/**
 * Creates a profile for the user identified by `token`. Ignores
 * `ProfileAlreadyExists` when the auth trigger already wrote the row.
 *
 * Not a hook: `AccountProvider` calls this outside of React mutation state.
 */
export async function createProfile(token: string): Promise<void> {
    const resp = await fetch(`${BACKEND_URL}/profile`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (resp.ok) return;

    const text = await resp.text();
    let data: { error_type?: string } = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        // non-JSON body
    }
    if (data.error_type === "ProfileAlreadyExists") return;

    throw data.error_type
        ? data
        : {
              error_type: "HttpError",
              status: resp.status,
              message: text,
          };
}
