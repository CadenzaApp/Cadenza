import { useAPIMutation } from "../api-actions";

export {
    cleanInviteCode,
    INVITE_CODE_ALPHABET,
    INVITE_CODE_LENGTH,
} from "../invite-code";

/** What a redeemed code joined. `id` is a playlist id or a session uuid. */
export type RedeemedInvite = {
    kind: "shared_playlist" | "live_session";
    id: string;
};

/** A code as `POST /.../invites` returns it. */
export type Invite = {
    code: string;
    /** `cadenza://join/{code}`. */
    link: string;
    grants_role: "viewer" | "editor" | null;
    expires_at: string | null;
    max_uses: number | null;
};

/** Options for a new code. All optional. */
export type CreateInviteBody = {
    /** Playlists only. Default `viewer`. */
    role?: "viewer" | "editor";
    expires_in_hours?: number;
    max_uses?: number;
};

/**
 * Redeems a code and joins what it points at, in one call. The joined
 * playlist list and the caller's current session are refetched after.
 */
export function useRedeemInvite() {
    const x = useAPIMutation<{ code: string }, RedeemedInvite>(
        "POST",
        ({ code }) => `/invites/${encodeURIComponent(code)}/redeem`,
        [{ path: "/shared-playlists" }, { path: "/live-sessions/current" }],
    );
    return {
        redeemInvite: x.trigger,
        redeemInviteLoading: x.isMutating,
        redeemInviteErr: x.error,
        resetRedeemInvite: x.reset,
    };
}
