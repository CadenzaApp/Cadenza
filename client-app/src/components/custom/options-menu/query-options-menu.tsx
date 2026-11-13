import type { MusicItem } from "@apple-musickit";
import { View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import { Separator } from "@/components/ui/separator";
import { usePlaybackCommands } from "@/lib/playback";
import { logHandledError } from "@/lib/log";

type QueryOptionsMenuProps = {
    /** The query is saved, so it can be rerun rather than saved. */
    saved: boolean;
    favorite: boolean;
    favoriteBusy?: boolean;
    /** Shown on the user's profile. */
    shared?: boolean;
    sharedBusy?: boolean;
    /** The songs Play next and Add to queue take, resolved on tap. */
    resolveTracks: () => Promise<MusicItem[]>;
    onToggleFavorite: () => void;
    /** Only offered once the query is saved. */
    onToggleShared?: () => void;
    /** Opens the name prompt. Only offered while the query is not saved. */
    onSave: () => void;
    /** Only offered once the query is saved. */
    onRerun: () => void;
    onClose: () => void;
};

/**
 * The query "..." menu: favorite, and once saved Share on profile, on their
 * own row, like the album and playlist menus, then Play next and Add to queue
 * against the results, then Save query or, once saved, Rerun query.
 */
export function QueryOptionsMenu({
    saved,
    favorite,
    favoriteBusy = false,
    shared = false,
    sharedBusy = false,
    resolveTracks,
    onToggleFavorite,
    onToggleShared,
    onSave,
    onRerun,
    onClose,
}: QueryOptionsMenuProps) {
    const { addToQueue, playNext } = usePlaybackCommands();

    const favoriteAction: MusicListAction<null> = {
        id: "favorite",
        label: favorite ? "Favorited" : "Favorite",
        icon: favorite ? "star" : "star-outline",
        onPress: onToggleFavorite,
    };
    const actions: MusicListAction<null>[] = [
        {
            id: "play-next",
            label: "Play next",
            icon: "play-skip-forward-outline",
            onPress: async () => playNext(await resolveTracks()),
        },
        {
            id: "add-to-queue",
            label: "Add to queue",
            icon: "list-outline",
            onPress: async () => addToQueue(await resolveTracks()),
        },
        saved
            ? {
                  id: "rerun",
                  label: "Rerun query",
                  icon: "refresh-outline",
                  onPress: onRerun,
              }
            : {
                  id: "save",
                  label: "Save query",
                  icon: "add-circle-outline",
                  onPress: onSave,
              },
    ];

    return (
        <ModalPopup visible onClose={onClose} title="Query options">
            <View className="flex-row gap-2">
                <MusicListActionButton
                    action={favoriteAction}
                    target={null}
                    onPress={onToggleFavorite}
                    busy={favoriteBusy}
                    selected={favorite}
                    toolbar
                />
                {onToggleShared ? (
                    <MusicListActionButton
                        action={{
                            id: "share-on-profile",
                            label: shared ? "On profile" : "Share on profile",
                            icon: shared
                                ? "person-circle"
                                : "person-circle-outline",
                            onPress: onToggleShared,
                        }}
                        target={null}
                        onPress={onToggleShared}
                        busy={sharedBusy}
                        selected={shared}
                        toolbar
                    />
                ) : null}
            </View>
            <Separator className="my-1" />

            {actions.map((action) => (
                <MusicListActionButton
                    key={action.id}
                    action={action}
                    target={null}
                    onPress={() => {
                        onClose();
                        void Promise.resolve(action.onPress(null)).catch(
                            (error) => {
                                logHandledError(
                                    `Query action failed: ${action.id}`,
                                    error,
                                );
                            },
                        );
                    }}
                />
            ))}
        </ModalPopup>
    );
}
