import { View } from "react-native";

import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import { Separator } from "@/components/ui/separator";

/**
 * The favorite + share icon row every options menu leads with, followed by a
 * divider. Generic over the target type so both the song and the collection
 * menus can reuse it.
 */
export function FavoriteShareRow<T>({
    target,
    isFavorite,
    onToggleFavorite,
    favoriteBusy = false,
    favoriteDisabled = false,
    onShare,
    shareDisabled = false,
}: {
    target: T;
    isFavorite: boolean;
    onToggleFavorite: () => void;
    favoriteBusy?: boolean;
    favoriteDisabled?: boolean;
    onShare: () => void;
    shareDisabled?: boolean;
}) {
    const favoriteAction: MusicListAction<T> = {
        id: "favorite",
        label: isFavorite ? "Favorited" : "Favorite",
        icon: isFavorite ? "star" : "star-outline",
        onPress: onToggleFavorite,
    };
    const shareAction: MusicListAction<T> = {
        id: "share",
        label: "Share",
        icon: "share-outline",
        onPress: onShare,
    };

    return (
        <>
            <View className="flex-row gap-2">
                <MusicListActionButton
                    action={favoriteAction}
                    target={target}
                    onPress={onToggleFavorite}
                    busy={favoriteBusy}
                    disabled={favoriteDisabled}
                    selected={isFavorite}
                    toolbar
                />
                <MusicListActionButton
                    action={shareAction}
                    target={target}
                    onPress={onShare}
                    disabled={shareDisabled}
                    toolbar
                />
            </View>
            <Separator className="my-1" />
        </>
    );
}
