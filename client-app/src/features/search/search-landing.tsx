import { View } from "react-native";
import Animated from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { useUserTags } from "@/lib/routes/tags";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { TagShelf } from "./tag-shelf";

/**
 * The Search tab before you tap the field. Apple fills this with browse
 * categories; we fill it with the user's own tags. Recents belong to the
 * focused state, the same way Apple's do.
 */
export function SearchLanding() {
    const scroll = useScreenScroll();
    const { listBottomInset } = useScreenOverlayInsets();
    // Shared with `TagShelf` through the SWR cache, so this costs one request.
    const { userTags } = useUserTags();

    if ((userTags?.length ?? 0) === 0) {
        return (
            <View className="flex-1 items-center justify-center px-10 pb-24">
                <Text className="text-center text-muted-foreground">
                    Tag some songs and they will show up here.
                </Text>
            </View>
        );
    }

    return (
        <ScreenScrollMarker>
            <Animated.ScrollView
            {...scroll}
            className="flex-1"
            contentContainerStyle={{ paddingBottom: listBottomInset }}
            showsVerticalScrollIndicator={false}
        >
            <TagShelf />
        </Animated.ScrollView>
        </ScreenScrollMarker>
    );
}
