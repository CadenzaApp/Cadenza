import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import { useDeletePost, useRemoveCachedPost } from "@/lib/routes/social";

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
        label: "Edit Post",
        icon: "pencil-outline",
        onPress: () => {
            onEdit?.();
            onClose();
        },
    };

    const deleteAction: MusicListAction<SocialPost> = {
        id: "delete-post",
        label: "Delete Post",
        icon: "trash-outline",
        labelColor: "destructive",
        iconColor: "destructive",
        onPress: (target) => {
            onDeleted?.(target.post_id);
            onClose();
            if (target.post_id <= 0) return;
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
