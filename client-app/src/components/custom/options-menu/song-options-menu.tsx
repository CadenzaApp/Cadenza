import type { MusicItem } from "@apple-musickit";
import type { Href } from "expo-router";
import { memo, useState } from "react";
import { Alert } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type {
    MusicListAction,
    MusicListTrackAction,
} from "@/components/custom/music-list/types";
import { SongTagSelectorPopup } from "@/components/custom/tag-selector/song-popup";
import { albumRouteForTrack } from "@/lib/music-routes";
import { useSongArtists, useSongFavoriteStatus } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import { usePlaybackCommands } from "@/lib/playback";
import { shareTrack } from "@/lib/share-track";
import { classifyError } from "@/lib/app-error";

import { FavoriteShareRow } from "./favorite-share-row";

type NavigateFn = (href: Href) => void;

type SongOptionsMenuProps = {
    track: MusicItem | null;
    onClose: () => void;
    /**
     * How Add to Playlist / Go to Album / Go to Artist navigate. Defaults to
     * `useOpenScreen`. The now-playing sheet passes a function that dismisses
     * itself first, since those are full-screen routes pushed on top of it.
     */
    navigate?: NavigateFn;
    /** Caller-specific actions appended after the standard song actions. */
    extraActions?: readonly MusicListTrackAction[];
};

/**
 * The song "..." menu. Modify Tags is its first action and swaps the menu for
 * an inline selector popup, so any list or screen can edit one song in place.
 */
export const SongOptionsMenu = memo(function SongOptionsMenu({
    track,
    onClose,
    navigate,
    extraActions = [],
}: SongOptionsMenuProps) {
    const openScreen = useOpenScreen();
    const go = navigate ?? openScreen;
    const favoriteId = track?.catalogId ?? track?.id;
    const {
        favoriteStatus,
        favoriteStatusLoading,
        favoriteStatusErr,
        setSongFavoriteStatus,
    } = useSongFavoriteStatus(favoriteId);
    const { artistIds, artistIdsLoading } = useSongArtists(favoriteId);
    const [isUpdatingFavorite, setIsUpdatingFavorite] = useState(false);
    const [editingTags, setEditingTags] = useState(false);
    const { addToQueue, playNext } = usePlaybackCommands();

    if (!track) return null;
    const selectedTrack = track;
    const isFavorite = favoriteStatus?.isFavorite ?? false;
    const artistId = artistIds?.[0] ?? track.artistId;

    async function handleFavoriteToggle() {
        if (!favoriteStatus || isUpdatingFavorite) return;

        setIsUpdatingFavorite(true);
        try {
            await setSongFavoriteStatus(!favoriteStatus.isFavorite);
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

    function openAddToPlaylist() {
        const songId = selectedTrack.catalogId ?? selectedTrack.id;
        onClose();
        go({
            pathname: "/add-to-playlist",
            params: { songId, title: selectedTrack.title },
        });
    }

    function openAlbum() {
        const route = albumRouteForTrack(selectedTrack);
        if (!route) return;
        onClose();
        go(route);
    }

    function openArtist() {
        if (!artistId) return;
        onClose();
        go({
            pathname: "/artist/[id]",
            params: {
                id: artistId,
                name: selectedTrack.artistName ?? "Artist",
            },
        });
    }

    const rowActions: MusicListAction<MusicItem>[] = [
        {
            id: "modify-tags",
            label: "Modify Tags",
            icon: "pricetags",
            onPress: () => setEditingTags(true),
        },
        {
            id: "add-to-playlist",
            label: "Add to Playlist",
            icon: "add-circle-outline",
            onPress: openAddToPlaylist,
        },
        {
            id: "play-next",
            label: "Play Next",
            icon: "play-skip-forward-outline",
            onPress: () => {
                onClose();
                void playNext([selectedTrack]);
            },
        },
        {
            id: "add-to-queue",
            label: "Add to Queue",
            icon: "list-outline",
            onPress: () => {
                onClose();
                void addToQueue([selectedTrack]);
            },
        },
        {
            id: "go-to-album",
            label: "Go to Album",
            icon: "disc-outline",
            onPress: openAlbum,
        },
        {
            id: "go-to-artist",
            label: "Go to Artist",
            icon: "mic-outline",
            onPress: openArtist,
        },
    ];

    return (
        <>
            <ModalPopup visible={!editingTags} onClose={onClose}>
                {favoriteStatusErr ? (
                    <FavoriteShareRow
                        target={selectedTrack}
                        isFavorite={false}
                        onToggleFavorite={() => undefined}
                        favoriteDisabled
                        onShare={() => void shareTrack(selectedTrack)}
                    />
                ) : (
                    <FavoriteShareRow
                        target={selectedTrack}
                        isFavorite={isFavorite}
                        onToggleFavorite={() => void handleFavoriteToggle()}
                        favoriteBusy={
                            favoriteStatusLoading || isUpdatingFavorite
                        }
                        onShare={() => void shareTrack(selectedTrack)}
                    />
                )}

                {rowActions.map((action) => {
                    const isArtist = action.id === "go-to-artist";
                    const isAlbum = action.id === "go-to-album";
                    return (
                        <MusicListActionButton
                            key={action.id}
                            action={action}
                            target={selectedTrack}
                            busy={isArtist && artistIdsLoading}
                            disabled={
                                (isArtist && !artistId) ||
                                (isAlbum && !selectedTrack.albumID)
                            }
                        />
                    );
                })}

                {extraActions.map((action) => (
                    <MusicListActionButton
                        key={action.id}
                        action={action}
                        target={selectedTrack}
                        onPress={() => {
                            if (action.dismissMenu !== false) onClose();
                            void Promise.resolve(
                                action.onPress(selectedTrack),
                            ).catch((error) => {
                                console.error(
                                    `Song option ${action.id} failed:`,
                                    error,
                                );
                                const appError = classifyError(error);
                                Alert.alert(appError.title, appError.detail);
                            });
                        }}
                    />
                ))}
            </ModalPopup>
            <SongTagSelectorPopup
                track={selectedTrack}
                visible={editingTags}
                onClose={() => {
                    setEditingTags(false);
                    onClose();
                }}
            />
        </>
    );
});
