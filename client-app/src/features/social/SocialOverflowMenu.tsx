import { useRouter } from "expo-router";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import { useAccount } from "@/lib/account";

type Props = {
    open: boolean;
    onClose: () => void;
    onStartSession: () => void;
    onJoinSession: () => void;
};

/** The Social header's compact replacement for the former profile and friends cards. */
export function SocialOverflowMenu({
    open,
    onClose,
    onStartSession,
    onJoinSession,
}: Props) {
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
        {
            id: "social-start-session",
            label: "Start listening session",
            icon: "radio-outline",
            onPress: closeThen(onStartSession),
        },
        {
            id: "social-join-session",
            label: "Join listening session",
            icon: "keypad-outline",
            onPress: closeThen(onJoinSession),
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
