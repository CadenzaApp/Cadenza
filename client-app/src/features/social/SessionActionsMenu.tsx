import { useRouter, type Href } from "expo-router";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";

import { useCurrentLiveSession } from "../live-session/use-current-session";

type Props = {
    open: boolean;
    onClose: () => void;
};

/**
 * Start or join a live session, from the + on Your listening. In a session it offers to open it first, and starting says new.
 */
export function SessionActionsMenu({ open, onClose }: Props) {
    const router = useRouter();
    const session = useCurrentLiveSession();
    if (!open) return null;

    const closeThen = (action: () => void) => () => {
        onClose();
        action();
    };
    const actions: MusicListAction<null>[] = [
        ...(session
            ? [
                  {
                      id: "session-open",
                      label: "Open live session",
                      icon: "radio-outline",
                      onPress: closeThen(() => router.push("/player")),
                  } satisfies MusicListAction<null>,
              ]
            : []),
        {
            id: "session-start",
            label: session
                ? "Start a new live session"
                : "Start a live session",
            icon: "add-circle-outline",
            onPress: closeThen(() =>
                router.push("/live-session/new?openPlayer=1" as Href),
            ),
        },
        {
            id: "session-join",
            label: "Join a session",
            icon: "keypad-outline",
            onPress: closeThen(() => router.push("/join")),
        },
    ];

    return (
        <ModalPopup visible onClose={onClose} title="Live session">
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
