import { useMemo, useState, type ReactNode } from "react";

import { NewPlaylistPopup } from "@/components/custom/new-playlist-popup";
import type { SegmentOption } from "@/components/ui/segmented-control";
import { SharedPlaylistsList } from "@/features/shared-playlists/SharedPlaylistsScreen";
import { collectionRoute } from "@/lib/music-routes";
import { usePlaylistMutations } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import { useRailActions } from "@/lib/use-rail-actions";

import { LibraryCollections } from "./library-collections";
import { useLibraryViewSwitch } from "./library-view-switch";

type PlaylistsView = "library" | "shared";

const VIEWS: readonly SegmentOption<PlaylistsView>[] = [
    { value: "library", label: "Your playlists" },
    { value: "shared", label: "Shared playlists" },
];

/**
 * The Playlists category: the Apple Music library's playlists, or the shared
 * playlists made in Cadenza, picked by the switch at the top. Each sets its
 * own rail buttons: + for yours, + and Enter code for shared.
 */
export function LibraryPlaylists() {
    const { view, viewSwitch } = useLibraryViewSwitch(VIEWS);
    return view === "shared" ? (
        <SharedPlaylistsList header={viewSwitch} />
    ) : (
        <YourPlaylists header={viewSwitch} />
    );
}

/** The library's playlists, with + in the rail for a new empty one. */
function YourPlaylists({ header }: { header: ReactNode }) {
    const openScreen = useOpenScreen();
    const { createPlaylist } = usePlaylistMutations();
    const [creating, setCreating] = useState(false);
    const railActions = useMemo(
        () => [
            {
                icon: "add" as const,
                accessibilityLabel: "New playlist",
                onPress: () => setCreating(true),
            },
        ],
        [],
    );
    useRailActions(railActions);

    return (
        <>
            <LibraryCollections
                kind="playlist"
                playable={false}
                above={header}
            />
            {creating ? (
                <NewPlaylistPopup
                    onClose={() => setCreating(false)}
                    create={async (name) => {
                        const playlist = await createPlaylist(name, []);
                        setCreating(false);
                        openScreen(collectionRoute(playlist));
                    }}
                />
            ) : null}
        </>
    );
}
