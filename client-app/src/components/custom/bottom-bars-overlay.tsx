import { Platform, StyleSheet, View } from "react-native";
import { FullWindowOverlay } from "react-native-screens";

import { MediaPlayerHost } from "@/components/custom/media-player";
import { TabBarHost } from "@/components/custom/tab-bar";

/**
 * Keeps both global bottom bars above native stack presentations.
 *
 * iOS presents transparent detail routes in a native layer above ordinary
 * React siblings. `FullWindowOverlay` moves the bars to the window layer so
 * they remain visible there. Their hosts still own route visibility and
 * geometry.
 */
export function BottomBarsOverlay() {
    const bars = (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <TabBarHost />
            <MediaPlayerHost />
        </View>
    );

    if (Platform.OS !== "ios") return bars;

    return (
        <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
            {bars}
        </FullWindowOverlay>
    );
}
