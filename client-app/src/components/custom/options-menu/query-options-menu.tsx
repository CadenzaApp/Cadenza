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
    /** The songs Play next and Add to queue take, resolved on tap. */
    resolveTracks: () => Promise<MusicItem[]>;
    onToggleFavorite: () => void;
    /** Opens the name prompt. Only offered while the query is not saved. */
    onSave: () => void;
    /** Only offered once the query is saved. */
    onRerun: () => void;
    onClose: () => void;
};

/**
 * The query "..." menu: favorite on its own row, like the album and playlist
 * menus, then Play next and Add to queue against the results, then Save query
 * or, once saved, Rerun query.
 */
export function QueryOptionsMenu({
    saved,
    favorite,
    favoriteBusy = false,
    resolveTracks,
    onToggleFavorite,
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
