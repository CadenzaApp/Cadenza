import { useRouter } from "expo-router";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import { useAccount } from "@/lib/account";

type Props = {
    open: boolean;
    onClose: () => void;
};

/**
 * The Social header's menu: your profile and friends. Live sessions are on the
 * + of Your listening, so they are not repeated here.
 */
export function SocialOverflowMenu({ open, onClose }: Props) {
    const router = useRouter();
    const { account } = useAccount();
    if (!open) return null;

    const closeThen = (action: () => void) => () => {
        onClose();
        action();
    };
    const actions: MusicListAction<null>[] = [
        {
            id: "social-profile",
            label: "See my social profile",
            icon: "person-outline",
            onPress: closeThen(() => {
                if (account?.id) router.push(`/social/user/${account.id}`);
            }),
        },
        {
            id: "social-friends",
            label: "See friends",
            icon: "people-outline",
            onPress: closeThen(() => router.push("/social/friends")),
        },
    ];

    return (
        <ModalPopup visible onClose={onClose} title="Social">
            {actions.map((action) => (
                <MusicListActionButton
                    key={action.id}
                    action={action}
                    target={null}
                />
            ))}
        </ModalPopup>
    );
}
