import type { MusicItem } from "@apple-musickit";
import { useState } from "react";
import { Alert } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import {
    useCollectionFavoriteStatus,
    useCollectionInfo,
    type LibraryCollectionKind,
} from "@/lib/musickit-hooks";
import { usePlaybackCommands } from "@/lib/playback";
import { shareCollection } from "@/lib/share-track";

import { FavoriteShareRow } from "./favorite-share-row";

type CollectionOptionsMenuProps = {
    kind: LibraryCollectionKind;
    collectionId: string;
    /** The collection's songs, for Play Next / Add to Queue. */
    tracks: MusicItem[];
    onClose: () => void;
};

/**
 * The album/playlist "..." menu: favorite + share for the collection itself,
 * then Play Next / Add to Queue against its songs.
 */
export function CollectionOptionsMenu({
    kind,
    collectionId,
    tracks,
    onClose,
}: CollectionOptionsMenuProps) {
    const {
        favoriteStatus,
        favoriteStatusLoading,
        favoriteStatusErr,
        setCollectionFavoriteStatus,
    } = useCollectionFavoriteStatus(kind, collectionId);
    const { collection, collectionLoading } = useCollectionInfo(
        kind,
        collectionId,
    );
    const [isUpdatingFavorite, setIsUpdatingFavorite] = useState(false);
    const { addToQueue, playNext } = usePlaybackCommands();

    const isFavorite = favoriteStatus?.isFavorite ?? false;
    const title = kind === "playlist" ? "Playlist options" : "Album options";

    async function handleFavoriteToggle() {
        if (!favoriteStatus || isUpdatingFavorite) return;

        setIsUpdatingFavorite(true);
        try {
            await setCollectionFavoriteStatus(!favoriteStatus.isFavorite);
        } catch (error) {
            console.error("Unable to update Apple Music favorite.", error);
            Alert.alert(
                "Couldn’t Update Favorite",
                "Please check your Apple Music connection and try again.",
            );
        } finally {
            setIsUpdatingFavorite(false);
        }
    }

    const actions: MusicListAction<MusicItem[]>[] = [
        {
            id: "play-next",
            label: "Play next",
            icon: "play-skip-forward-outline",
            onPress: () => playNext(tracks),
        },
        {
            id: "add-to-queue",
            label: "Add to queue",
            icon: "list-outline",
            onPress: () => addToQueue(tracks),
        },
    ];

    return (
        <ModalPopup visible onClose={onClose} title={title} variant="glass">
            {favoriteStatusErr ? (
                <FavoriteShareRow
                    target={tracks}
                    isFavorite={false}
                    onToggleFavorite={() => undefined}
                    favoriteDisabled
                    onShare={() => collection && void shareCollection(collection)}
                    shareDisabled={!collection}
                />
            ) : (
                <FavoriteShareRow
                    target={tracks}
                    isFavorite={isFavorite}
                    onToggleFavorite={() => void handleFavoriteToggle()}
                    favoriteBusy={favoriteStatusLoading || isUpdatingFavorite}
                    onShare={() => collection && void shareCollection(collection)}
                    shareDisabled={collectionLoading || !collection?.shareUrl}
                />
            )}

            {actions.map((action) => (
                <MusicListActionButton
                    key={action.id}
                    action={action}
                    target={tracks}
                    onPress={() => {
                        onClose();
                        void Promise.resolve(action.onPress(tracks)).catch(
                            (error) => {
                                console.error(
                                    `Collection action failed: ${action.id}`,
                                    error,
                                );
                            },
                        );
                    }}
                    disabled={tracks.length === 0}
                />
            ))}
        </ModalPopup>
    );
}
