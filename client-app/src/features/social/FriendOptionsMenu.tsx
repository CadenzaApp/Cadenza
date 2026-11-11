import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";

/** Who the menu is about, and what the signed-in user already is to them. */
export type FriendMenuTarget = {
    user_id: string;
    username: string;
    isFriend: boolean;
    isFavorite: boolean;
};

type Props = {
    target: FriendMenuTarget | null;
    onClose: () => void;
    onFavorite: (favorite: boolean) => void;
    onUnfriend: () => void;
    /** Asks first; the menu only closes and hands off. */
    onBlock: () => void;
};

/**
 * The menu under a profile's Friends button, or its "..." for anyone else.
 * A friend gets Favorite and Unfriend; everyone gets Block. Each action
 * closes the menu first.
 */
export function FriendOptionsMenu({
    target,
    onClose,
    onFavorite,
    onUnfriend,
    onBlock,
}: Props) {
    if (!target) return null;

    const close = (then: () => void) => () => {
        onClose();
        then();
    };
    const actions: MusicListAction<FriendMenuTarget>[] = [];
    if (target.isFriend) {
        actions.push(
            {
                id: "favorite",
                label: target.isFavorite
                    ? "Remove from Favorites"
                    : "Add to Favorites",
                icon: target.isFavorite ? "star" : "star-outline",
                onPress: close(() => onFavorite(!target.isFavorite)),
            },
            {
                id: "unfriend",
                label: "Unfriend",
                icon: "person-remove-outline",
                labelColor: "destructive",
                iconColor: "destructive",
                onPress: close(onUnfriend),
            },
        );
    }
    actions.push({
        id: "block",
        label: "Block",
        icon: "ban-outline",
        labelColor: "destructive",
        iconColor: "destructive",
        onPress: close(onBlock),
    });

    return (
        <ModalPopup visible onClose={onClose}>
            {actions.map((action) => (
                <MusicListActionButton
                    key={action.id}
                    action={action}
                    target={target}
                />
            ))}
        </ModalPopup>
    );
}
