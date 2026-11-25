import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { useAPIData, useAPIMutation } from "../api-actions";

export type PlatformRole = "user" | "moderator" | "admin" | "owner";
export type RoleAccess = {
    role: PlatformRole;
    dashboard: boolean;
    allowed_roles: PlatformRole[];
};
export function useAdminAccess() {
    const { mutate } = useSWRConfig();
    const access = useAPIData<RoleAccess>("/admin/access", undefined, {
        refreshInterval: 30_000,
    });
    const revoked =
        !!access.error || (access.data !== undefined && !access.data.dashboard);
    useEffect(() => {
        if (revoked)
            void mutate(
                (key: unknown) =>
                    !!key &&
                    typeof key === "object" &&
                    "path" in key &&
                    typeof key.path === "string" &&
                    key.path.startsWith("/admin/") &&
                    key.path !== "/admin/access",
                undefined,
                { revalidate: false },
            );
    }, [revoked, mutate]);
    return access;
}
export function useRoleAccess(userId: string, enabled: boolean) {
    return useAPIData<RoleAccess>(`/admin/users/${userId}/role`, undefined, {
        enabled,
        refreshInterval: 30_000,
    });
}
export function useChangeRole(userId: string) {
    return useAPIMutation<
        { role: PlatformRole; expected_role: PlatformRole },
        { updated: boolean }
    >(
        "PATCH",
        `/admin/users/${userId}/role`,
        [{ path: "/admin/access" }, { path: `/admin/users/${userId}/role` }],
        { invalidation: "await" },
    );
}

export type AdminDay = {
    day: string;
    plays?: number;
    active_users?: number;
    posts?: number;
    listening_ms?: number;
    snapshot?: boolean;
    source_cutoff?: string;
};
export type AdminRankingRow = {
    name?: string;
    song_id?: string;
    artist_name?: string;
    artist_id?: string;
    post_id?: number;
    content?: string;
    plays?: number;
    listeners?: number;
    listening_ms?: number;
    skips?: number;
    endings?: number;
    skip_rate?: number | null;
    early_skip_rate?: number | null;
    likes?: number;
    accounts?: number;
    songs?: number;
};
export type AdminMetrics = {
    days?: AdminDay[];
    trend?: AdminMetrics;
    songs?: AdminRankingRow[];
    artists?: AdminRankingRow[];
    tags?: AdminRankingRow[];
    skipped?: AdminRankingRow[];
    posts?: AdminRankingRow[];
    rows?: AdminRankingRow[];
    total?: number;
    active_users?: number;
    average_dau?: number;
    stickiness?: number | null;
    source_cutoff?: string;
    since?: string;
    until?: string;
    snapshot?: boolean;
    rates?: AdminRankingRow;
    song_endings?: {
        day: string;
        completed: number;
        skips: number;
        early_skips: number;
    }[];
};
