import type { PlaylistRole } from "@/lib/routes/shared-playlists";

const LABELS: Record<PlaylistRole, string> = {
    owner: "Owner",
    editor: "Editor",
    viewer: "Viewer",
};

/** A playlist role as people read it. */
export function roleLabel(role: PlaylistRole): string {
    return LABELS[role];
}

/** The roles an owner can give someone. Owner is fixed. */
export const ASSIGNABLE_ROLES = [
    { value: "editor", label: "Editor" },
    { value: "viewer", label: "Viewer" },
] as const;
