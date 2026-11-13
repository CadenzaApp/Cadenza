import type { SegmentOption } from "@/components/ui/segmented-control";
import { SharedPlaylistsList } from "@/features/shared-playlists/SharedPlaylistsScreen";

import { LibraryCollections } from "./library-collections";
import { useLibraryViewSwitch } from "./library-view-switch";

type PlaylistsView = "library" | "shared";

const VIEWS: readonly SegmentOption<PlaylistsView>[] = [
    { value: "library", label: "Your playlists" },
    { value: "shared", label: "Shared playlists" },
];

/**
 * The Playlists category: the Apple Music library's playlists, or the shared
 * playlists made in Cadenza, picked by the switch at the top.
 */
export function LibraryPlaylists() {
    const { view, viewSwitch } = useLibraryViewSwitch(VIEWS);
    return view === "shared" ? (
        <SharedPlaylistsList header={viewSwitch} />
    ) : (
        <LibraryCollections
            kind="playlist"
            playable={false}
            above={viewSwitch}
        />
    );
}
