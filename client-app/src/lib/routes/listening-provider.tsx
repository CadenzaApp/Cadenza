import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useAccount } from "../account";
import {
    useFriendsListening as useFriendsListeningRead,
    useUserListening,
    type FriendListening,
    type UserListening,
} from "./listening";

/**
 * One shared read of who is listening. Several social surfaces show it at once
 * (the stories strip, the friends list, the hub cards, the feed), and each used
 * to mount its own `useFriendsListening`, so the same `/listening/friends` and
 * `/listening/users/{me}` reads polled several times over, out of phase. This
 * provider mounts each read once and hands it down, so there is a single poll no
 * matter how many surfaces are open. Both reads refetch on realtime events and,
 * only while the socket is down, every 10 s.
 */
type ListeningContextValue = {
    friendsListening: FriendListening[] | undefined;
    friendsListeningLoading: boolean;
    friendsListeningErr: unknown;
    myListening: UserListening | undefined;
};

const ListeningContext = createContext<ListeningContextValue | null>(null);

export function ListeningProvider({ children }: { children: ReactNode }) {
    const { account } = useAccount();
    const friends = useFriendsListeningRead();
    const { userListening: myListening } = useUserListening(account?.id ?? null);

    const value = useMemo<ListeningContextValue>(
        () => ({
            friendsListening: friends.friendsListening,
            friendsListeningLoading: friends.friendsListeningLoading,
            friendsListeningErr: friends.friendsListeningErr,
            myListening,
        }),
        [
            friends.friendsListening,
            friends.friendsListeningLoading,
            friends.friendsListeningErr,
            myListening,
        ],
    );

    return (
        <ListeningContext.Provider value={value}>
            {children}
        </ListeningContext.Provider>
    );
}

function useListeningContext() {
    const ctx = useContext(ListeningContext);
    if (!ctx) {
        throw new Error(
            "useFriendsListeningShared / useMyListening require ListeningProvider.",
        );
    }
    return ctx;
}

/** Friends playing now, from the one shared read. */
export function useFriendsListeningShared() {
    const { friendsListening, friendsListeningLoading, friendsListeningErr } =
        useListeningContext();
    return { friendsListening, friendsListeningLoading, friendsListeningErr };
}

/** The signed-in user's own now playing, from the one shared read. */
export function useMyListening() {
    return useListeningContext().myListening;
}
