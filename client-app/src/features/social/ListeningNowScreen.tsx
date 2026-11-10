import { useNavigation } from "expo-router";
import { useLayoutEffect } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { AllListening } from "./ListeningNow";

/** Every friend listening right now, as full cards. From See all. */
export function ListeningNowScreen() {
    const navigation = useNavigation();
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll();

    useLayoutEffect(() => {
        navigation.setOptions({ title: "Listening now" });
    }, [navigation]);

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.ScrollView
                    {...scroll}
                    className="flex-1"
                    contentContainerStyle={[
                        {
                            paddingHorizontal: 20,
                            paddingTop: 8,
                            paddingBottom: listBottomInset + 48,
                        },
                        scroll.contentContainerStyle,
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    <AllListening />
                </Animated.ScrollView>
            </ScreenScrollMarker>
        </View>
    );
}
