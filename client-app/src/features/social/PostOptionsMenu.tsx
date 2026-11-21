import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { ErrorNotice } from "@/components/custom/error-notice";
import { logHandledError } from "@/lib/log";
import { useSongArtists } from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import type { PostTopic } from "@/lib/types";
import { musicItemFromSongTopic } from "./topic";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import {
    useHiddenSpotlights,
    useDeletePost,
    useRemoveCachedPost,
} from "@/lib/routes/social";

import type { SocialPost } from "./types";

type Props = {
    post: SocialPost | null;
    onClose: () => void;
    /** Drops the post from a list the cache does not own, such as one just written. */
    onDeleted?: (postId: number) => void;
    /** Opens the inline editor. The menu closes first. */
    onEdit?: () => void;
    /** The delete request failed. The caller can show the post again. */
    onDeleteFailed?: (postId: number) => void;
};

/** The post "..." menu, the same liquid-glass popup songs use. */
export function PostOptionsMenu({
    post,
    onClose,
    onDeleted,
    onDeleteFailed,
    onEdit,
}: Props) {
    const { deletePost } = useDeletePost();
    const removeCachedPost = useRemoveCachedPost();

    if (!post) return null;

    const editAction: MusicListAction<SocialPost> = {
        id: "edit-post",
        label: "Edit post",
        icon: "pencil-outline",
        onPress: () => {
            onEdit?.();
            onClose();
        },
    };

    const deleteAction: MusicListAction<SocialPost> = {
        id: "delete-post",
        label: "Delete post",
        icon: "trash-outline",
        labelColor: "destructive",
        iconColor: "destructive",
        onPress: (target) => {
            onDeleted?.(target.post_id);
            onClose();
            void deletePost(target.post_id)
                .then(() => removeCachedPost(target.post_id))
                .catch((error) => {
                    console.error("Deleting a post failed", error);
                    onDeleteFailed?.(target.post_id);
                });
        },
    };

    return (
        <ModalPopup visible onClose={onClose}>
            <MusicListActionButton action={editAction} target={post} />
            <MusicListActionButton action={deleteAction} target={post} />
        </ModalPopup>
    );
}

export function SpotlightOptionsMenu({
    topic,
    postId,
    onClose,
}: {
    topic: PostTopic;
    postId: number;
    onClose: () => void;
}) {
    const router = useRouter();
    const openScreen = useOpenScreen();
    const { hideSpotlight } = useHiddenSpotlights();
    const song = topic.kind === "song" ? topic : null;
    const id = topic.catalogId ?? topic.id;
    const { artistIds, artistIdsLoading, artistIdsErr } = useSongArtists(
        song ? id : undefined,
    );
    const artistId = artistIds?.[0];
    const actions: MusicListAction<PostTopic>[] = [
        {
            id: "hide-spotlight",
            label: "Hide this post",
            icon: "eye-off-outline",
            onPress: async () => {
                try {
                    await hideSpotlight(postId);
                    onClose();
                } catch (error) {
                    logHandledError("Hide spotlight", error);
                    Alert.alert("Couldn't hide post", "Please try again.");
                }
            },
        },
    ];
    if (song)
        actions.push(
            {
                id: "spotlight-song",
                label: "Go to song",
                icon: "musical-notes-outline",
                onPress: () => {
                    onClose();
                    router.push({
                        pathname: "/player",
                        params: {
                            song: JSON.stringify(musicItemFromSongTopic(song)),
                        },
                    });
                },
            },
            {
                id: "spotlight-artist",
                label: "Go to artist",
                icon: "person-outline",
                onPress: () => {
                    if (!artistId) return;
                    onClose();
                    openScreen({
                        pathname: "/artist/[id]",
                        params: {
                            id: artistId,
                            name: song.artistName ?? "Artist",
                        },
                    });
                },
            },
        );
    return (
        <ModalPopup visible onClose={onClose}>
            {actions.map((action) => (
                <MusicListActionButton
                    key={action.id}
                    action={action}
                    target={topic}
                    busy={action.id === "spotlight-artist" && artistIdsLoading}
                    disabled={action.id === "spotlight-artist" && !artistId}
                />
            ))}
            {artistIdsErr ? <ErrorNotice error={artistIdsErr} /> : null}
        </ModalPopup>
    );
}
