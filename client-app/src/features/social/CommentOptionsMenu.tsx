import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import {
    useDeleteComment,
    useRemoveCachedComment,
    useUpdateCachedPostCommentCount,
} from "@/lib/routes/social";

import type { SocialComment } from "./types";

type Props = {
    comment: SocialComment | null;
    onClose: () => void;
    /** The comment left the server. The caller drops any copy the cache does not own. */
    onDeleted?: (comment: SocialComment) => void;
    /** Opens the inline editor. The menu closes first. */
    onEdit?: () => void;
};

/** The comment "..." menu, the same popup a post uses. */
export function CommentOptionsMenu({
    comment,
    onClose,
    onDeleted,
    onEdit,
}: Props) {
    const { deleteComment } = useDeleteComment();
    const removeCachedComment = useRemoveCachedComment();
    const updateCommentCount = useUpdateCachedPostCommentCount();

    if (!comment) return null;

    const editAction: MusicListAction<SocialComment> = {
        id: "edit-comment",
        label: "Edit Comment",
        icon: "pencil-outline",
        onPress: () => {
            onEdit?.();
            onClose();
        },
    };

    const deleteAction: MusicListAction<SocialComment> = {
        id: "delete-comment",
        label: "Delete Comment",
        icon: "trash-outline",
        labelColor: "destructive",
        iconColor: "destructive",
        onPress: async (target) => {
            await deleteComment(target.comment_id);
            await removeCachedComment(target.post_id, target.comment_id);
            await updateCommentCount(target.post_id, -1);
            onDeleted?.(target);
            onClose();
        },
    };

    return (
        <ModalPopup visible onClose={onClose}>
            <MusicListActionButton action={editAction} target={comment} />
            <MusicListActionButton action={deleteAction} target={comment} />
        </ModalPopup>
    );
}
