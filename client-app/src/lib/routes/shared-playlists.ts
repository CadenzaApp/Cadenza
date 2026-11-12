import { useAPIData, useAPIMutation } from "../api-actions";
import { useRealtimeTopic } from "../realtime";
import type { CreateInviteBody, Invite } from "./invites";

export type PlaylistRole = "owner" | "editor" | "viewer";

/** What the caller's role allows, from the backend's own table. */
export type PlaylistPermissions = {
    edit_songs: boolean;
    edit_details: boolean;
    manage_members: boolean;
    make_invite: boolean;
    delete: boolean;
};

/** One playlist in `GET /shared-playlists`. */
export type SharedPlaylistSummary = {
    playlist_id: number;
    name: string;
    description: string;
    owner: { user_id: string; username: string };
    role: PlaylistRole;
    can: PlaylistPermissions;
    song_count: number;
    member_count: number;
    /** The first four songs' catalog ids, for a cover mosaic. */
    cover_song_ids: string[];
    version: number;
    updated_at: string;
};

export type SharedPlaylistMember = {
    user_id: string;
    username: string;
    role: PlaylistRole;
    joined_at: string;
};

/** One song. Its title and art come from Apple Music by `song_id`. */
export type SharedPlaylistEntry = {
    entry_id: number;
    song_id: string;
    position: number;
    added_by: string | null;
    added_at: string;
};

/** `GET /shared-playlists/{id}`. */
export type SharedPlaylist = {
    playlist_id: number;
    owner_id: string;
    name: string;
    description: string;
    version: number;
    my_role: PlaylistRole;
    can: PlaylistPermissions;
    members: SharedPlaylistMember[];
    entries: SharedPlaylistEntry[];
    created_at: string;
    updated_at: string;
};

/** What every write returns. `deleted` when the owner left or deleted it. */
export type PlaylistVersion = { version: number | null; deleted: boolean };

const LIST = { path: "/shared-playlists" };
const detail = (id: number) => ({ path: `/shared-playlists/${id}` });

/** The caller's shared playlists, most recently changed first. */
export function useSharedPlaylists() {
    const x = useAPIData<{ playlists: SharedPlaylistSummary[] }>(
        "/shared-playlists",
    );
    return {
        sharedPlaylists: x.data?.playlists,
        sharedPlaylistsLoading: x.isLoading,
        sharedPlaylistsErr: x.error,
        reloadSharedPlaylists: x.mutate,
    };
}

/**
 * One shared playlist, refetched whenever another member changes it, through
 * the realtime socket.
 */
export function useSharedPlaylist(id: number | null) {
    const x = useAPIData<SharedPlaylist>(`/shared-playlists/${id}`, undefined, {
        enabled: id !== null,
    });
    useRealtimeTopic(
        id !== null ? { kind: "shared_playlist", id } : null,
        (event) => {
            // our own writes already refetched; a newer version did not come from us
            if (event.kind === "resync" || event.version !== x.data?.version) {
                void x.mutate();
            }
        },
    );
    return {
        sharedPlaylist: x.data,
        sharedPlaylistLoading: x.isLoading,
        sharedPlaylistErr: x.error,
        reloadSharedPlaylist: x.mutate,
    };
}

export function useCreateSharedPlaylist() {
    const x = useAPIMutation<
        { name: string; description?: string; song_ids?: string[] },
        { playlist_id: number }
    >("POST", "/shared-playlists", [LIST]);
    return {
        createSharedPlaylist: x.trigger,
        createSharedPlaylistLoading: x.isMutating,
        createSharedPlaylistErr: x.error,
    };
}

/** Adds songs to a playlist named at call time, like from Add to playlist. */
export function useAddToSharedPlaylist() {
    const x = useAPIMutation<
        { playlist_id: number; song_ids: string[] },
        PlaylistVersion
    >(
        "POST",
        ({ playlist_id }) => `/shared-playlists/${playlist_id}/songs`,
        ({ playlist_id }) => [LIST, detail(playlist_id)],
    );
    return {
        addToSharedPlaylist: x.trigger,
        addToSharedPlaylistLoading: x.isMutating,
    };
}

/**
 * Every write to one playlist. Each refetches the playlist and the list after
 * it. A stale `expected_version` is a 409 `VersionConflict`; the refetch is
 * the fix.
 */
export function useSharedPlaylistWrites(id: number) {
    const touched = [detail(id), LIST];
    const base = `/shared-playlists/${id}`;

    const update = useAPIMutation<
        { name?: string; description?: string; expected_version?: number },
        PlaylistVersion
    >("PATCH", base, touched);
    const remove = useAPIMutation<void, PlaylistVersion>("DELETE", base, [
        LIST,
    ]);
    const addSongs = useAPIMutation<
        { song_ids: string[]; position?: number; expected_version?: number },
        PlaylistVersion
    >("POST", `${base}/songs`, touched);
    const removeSong = useAPIMutation<{ entry_id: number }, PlaylistVersion>(
        "DELETE",
        ({ entry_id }) => `${base}/songs/${entry_id}`,
        touched,
    );
    const moveSong = useAPIMutation<
        { entry_id: number; position: number },
        PlaylistVersion
    >("PATCH", ({ entry_id }) => `${base}/songs/${entry_id}`, touched);
    const addMember = useAPIMutation<
        { user_id: string; role: "viewer" | "editor" },
        PlaylistVersion
    >("POST", `${base}/members`, touched);
    const setRole = useAPIMutation<
        { user_id: string; role: "viewer" | "editor" },
        PlaylistVersion
    >("PATCH", ({ user_id }) => `${base}/members/${user_id}`, touched);
    const removeMember = useAPIMutation<{ user_id: string }, PlaylistVersion>(
        "DELETE",
        ({ user_id }) => `${base}/members/${user_id}`,
        touched,
    );
    const invite = useAPIMutation<CreateInviteBody, Invite>(
        "POST",
        `${base}/invites`,
        [],
        { invalidation: "none" },
    );

    return {
        updateDetails: update.trigger,
        deletePlaylist: () => remove.trigger(),
        addSongs: addSongs.trigger,
        removeSong: removeSong.trigger,
        moveSong: moveSong.trigger,
        addMember: addMember.trigger,
        setMemberRole: setRole.trigger,
        removeMember: removeMember.trigger,
        createInvite: invite.trigger,
        writing:
            update.isMutating ||
            remove.isMutating ||
            addSongs.isMutating ||
            removeSong.isMutating ||
            moveSong.isMutating ||
            addMember.isMutating ||
            setRole.isMutating ||
            removeMember.isMutating,
    };
}
