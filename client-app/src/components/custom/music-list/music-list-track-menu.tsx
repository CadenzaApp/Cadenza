import type { MusicItem } from "@apple-musickit";
import { useState } from "react";
import { Alert } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { useSongFavoriteStatus } from "@/lib/musickit-hooks";
import { usePlayback } from "@/lib/playback";

import { MusicListActionButton } from "./music-list-action-button";
import type { MusicListTrackAction } from "./types";

type MusicListTrackMenuProps = {
    track: MusicItem | null;
    onClose: () => void;
    onShowDetails: (track: MusicItem) => void;
    actions: readonly MusicListTrackAction[];
};

export function MusicListTrackMenu({
    track,
    onClose,
    onShowDetails,
    actions,
}: MusicListTrackMenuProps) {
    const { addToQueue } = usePlayback();
    const favoriteId = track?.catalogId ?? track?.id;
    const {
        favoriteStatus,
        favoriteStatusLoading,
        favoriteStatusErr,
        setSongFavoriteStatus,
    } = useSongFavoriteStatus(favoriteId);
    const [updatingFavoriteId, setUpdatingFavoriteId] = useState<string | null>(
        null,
    );
    const isUpdatingFavorite = updatingFavoriteId === favoriteId;

    if (!track) return null;
    const selectedTrack = track;

    const detailsAction: MusicListTrackAction = {
        id: "song-details",
        label: "Song details",
        icon: "information-circle-outline",
        onPress: (selectedTrack) => {
            onShowDetails(selectedTrack);
        },
    };
    const favoriteAction: MusicListTrackAction = {
        id: "favorite",
        label: favoriteStatus?.isFavorite ? "Unfavorite" : "Favorite",
        icon: favoriteStatus?.isFavorite ? "star" : "star-outline",
        dismissMenu: false,
        onPress: () => void handleFavoriteToggle(),
    };
    const queueAction: MusicListTrackAction = {
        id: "add-to-queue",
        label: "Add to queue",
        icon: "list-outline",
        onPress: (selectedTrack) => addToQueue([selectedTrack]),
    };

    async function handleFavoriteToggle() {
        if (!favoriteStatus || isUpdatingFavorite) return;

        setUpdatingFavoriteId(favoriteId ?? null);
        try {
            await setSongFavoriteStatus(!favoriteStatus.isFavorite);
        } catch (error) {
            console.error("Unable to update Apple Music favorite.", error);
            Alert.alert(
                "Couldn’t Update Favorite",
                "Please check your Apple Music connection and try again.",
            );
        } finally {
            setUpdatingFavoriteId(null);
        }
    }

    function runTrackAction(action: MusicListTrackAction) {
        if (action.dismissMenu !== false) onClose();
        void Promise.resolve(action.onPress(selectedTrack)).catch((error) => {
            console.error(`Music list action failed: ${action.id}`, error);
        });
    }

    return (
        <ModalPopup visible onClose={onClose} title="Song options">
            <MusicListActionButton
                action={detailsAction}
                target={track}
                onPress={() => runTrackAction(detailsAction)}
            />
            {favoriteStatusErr ? (
                <MusicListActionButton
                    action={{
                        ...favoriteAction,
                        label: "Favorite status unavailable",
                        icon: "warning-outline",
                        labelColor: "destructive",
                    }}
                    target={track}
                    onPress={() => undefined}
                    disabled
                />
            ) : (
                <MusicListActionButton
                    action={favoriteAction}
                    target={track}
                    onPress={() => runTrackAction(favoriteAction)}
                    busy={favoriteStatusLoading || isUpdatingFavorite}
                    selected={favoriteStatus?.isFavorite ?? false}
                />
            )}
            <MusicListActionButton
                action={queueAction}
                target={track}
                onPress={() => runTrackAction(queueAction)}
            />
            {actions.map((action) => (
                <MusicListActionButton
                    key={action.id}
                    action={action}
                    target={track}
                    onPress={() => runTrackAction(action)}
                />
            ))}
        </ModalPopup>
    );
}
