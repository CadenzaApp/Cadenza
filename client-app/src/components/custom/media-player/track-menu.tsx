import type { MusicItem, SongFavoriteStatus } from "@apple-musickit";
import { View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListTrackAction } from "@/components/custom/music-list/types";
import { Separator } from "@/components/ui/separator";

type MediaPlayerTrackMenuProps = {
    track: MusicItem;
    favoriteStatus: SongFavoriteStatus | null | undefined;
    isFavoriteStatusLoading: boolean;
    isUpdatingFavorite: boolean;
    /** False while the song's artist is still being resolved, or has none. */
    canGoToArtist: boolean;
    isArtistLoading: boolean;
    onClose: () => void;
    onFavoriteToggle: () => void;
    onShare: () => void;
    onEditTags: () => void;
    onAddToPlaylist: () => void;
    onGoToAlbum: () => void;
    onGoToArtist: () => void;
};

/**
 * The `...` menu for the song that is playing. Presentational: every action is
 * a prop, so the sheet keeps one copy of the favorite and artist state rather
 * than this menu opening its own.
 */
export function MediaPlayerTrackMenu({
    track,
    favoriteStatus,
    isFavoriteStatusLoading,
    isUpdatingFavorite,
    canGoToArtist,
    isArtistLoading,
    onClose,
    onFavoriteToggle,
    onShare,
    onEditTags,
    onAddToPlaylist,
    onGoToAlbum,
    onGoToArtist,
}: MediaPlayerTrackMenuProps) {
    const isFavorite = favoriteStatus?.isFavorite ?? false;

    const favoriteAction: MusicListTrackAction = {
        id: "favorite",
        label: isFavorite ? "Favorited" : "Favorite",
        icon: isFavorite ? "star" : "star-outline",
        dismissMenu: false,
        onPress: onFavoriteToggle,
    };
    const shareAction: MusicListTrackAction = {
        id: "share",
        label: "Share",
        icon: "share-outline",
        onPress: onShare,
    };
    const rowActions: MusicListTrackAction[] = [
        {
            id: "edit-tags",
            label: "Edit Tags",
            icon: "pricetags-outline",
            onPress: onEditTags,
        },
        {
            id: "add-to-playlist",
            label: "Add to Playlist",
            icon: "add-circle-outline",
            onPress: onAddToPlaylist,
        },
        {
            id: "go-to-album",
            label: "Go to Album",
            icon: "disc-outline",
            onPress: onGoToAlbum,
        },
        {
            id: "go-to-artist",
            label: "Go to Artist",
            icon: "mic-outline",
            onPress: onGoToArtist,
        },
    ];

    function run(action: MusicListTrackAction) {
        if (action.dismissMenu !== false) onClose();
        void Promise.resolve(action.onPress(track)).catch((error) => {
            console.error(`Player menu action failed: ${action.id}`, error);
        });
    }

    return (
        <ModalPopup visible onClose={onClose}>
            <View className="flex-row gap-2">
                <MusicListActionButton
                    action={favoriteAction}
                    target={track}
                    onPress={() => run(favoriteAction)}
                    busy={isFavoriteStatusLoading || isUpdatingFavorite}
                    disabled={favoriteStatus === null}
                    selected={isFavorite}
                    toolbar
                />
                <MusicListActionButton
                    action={shareAction}
                    target={track}
                    onPress={() => run(shareAction)}
                    toolbar
                />
            </View>

            <Separator className="my-1" />

            {rowActions.map((action) => {
                const isArtist = action.id === "go-to-artist";
                const isAlbum = action.id === "go-to-album";
                return (
                    <MusicListActionButton
                        key={action.id}
                        action={action}
                        target={track}
                        onPress={() => run(action)}
                        busy={isArtist && isArtistLoading}
                        disabled={
                            (isArtist && !canGoToArtist) ||
                            (isAlbum && !track.albumID)
                        }
                    />
                );
            })}
        </ModalPopup>
    );
}
