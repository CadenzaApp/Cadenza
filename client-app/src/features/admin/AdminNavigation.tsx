import { useAppTheme } from "@/lib/theme";
import { useEffect, useMemo, useState } from "react";
import { PanResponder, View } from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";
import {
    MaskedTabIcons,
    PlayerBarShell,
    PLAYER_BAR_INSET,
} from "@/components/custom/media-player/player-bar";
import { releasedPageIndex } from "@/components/custom/media-player/player-bar-drag";

const TABS = ["listening", "tags", "users", "social"] as const;
const PRESENTATION = {
    listening: {
        label: "Listening",
        sf: { active: "waveform.path.ecg", inactive: "waveform.path.ecg" },
        icon: { active: "pulse", inactive: "pulse-outline" },
    },
    tags: {
        label: "Tags",
        sf: { active: "tag.fill", inactive: "tag" },
        icon: { active: "pricetags", inactive: "pricetags-outline" },
    },
    users: {
        label: "Users",
        sf: { active: "person.2.fill", inactive: "person.2" },
        icon: { active: "people", inactive: "people-outline" },
    },
    social: {
        label: "Social",
        sf: {
            active: "bubble.left.and.bubble.right.fill",
            inactive: "bubble.left.and.bubble.right",
        },
        icon: { active: "chatbubbles", inactive: "chatbubbles-outline" },
    },
} as const;

/** Shares the player's exact masked glyphs, stretching capsule and glass shell. */
export function AdminNavigation({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    const { scheme } = useAppTheme();
    const [width, setWidth] = useState(0);
    const selected = Math.max(
        0,
        TABS.findIndex((tab) => tab === value),
    );
    const progress = useSharedValue(selected);
    useEffect(() => {
        progress.set(withTiming(selected, { duration: 220 }));
    }, [selected, progress]);
    const responder = useMemo(() => {
        const itemWidth = (width - PLAYER_BAR_INSET * 2) / TABS.length;
        return PanResponder.create({
            onMoveShouldSetPanResponder: (_, g) =>
                width > 0 &&
                Math.abs(g.dx) > 2 &&
                Math.abs(g.dx) > Math.abs(g.dy),
            onPanResponderMove: (_, g) =>
                progress.set(
                    Math.max(
                        0,
                        Math.min(TABS.length - 1, selected + g.dx / itemWidth),
                    ),
                ),
            onPanResponderRelease: (_, g) => {
                const index = releasedPageIndex(
                    progress.get(),
                    g.vx * 1000,
                    itemWidth,
                    1,
                    TABS.length,
                );
                progress.set(withTiming(index, { duration: 220 }));
                onChange(TABS[index]);
            },
            onPanResponderTerminate: () =>
                progress.set(withTiming(selected, { duration: 220 })),
            onPanResponderTerminationRequest: () => false,
        });
    }, [width, selected, progress, onChange]);
    return (
        <PlayerBarShell onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            <View className="flex-1" {...responder.panHandlers}>
                <MaskedTabIcons
                    tabs={TABS}
                    presentation={PRESENTATION}
                    inactiveColor={scheme === "dark" ? "#ffffff" : "#000000"}
                    barWidth={width}
                    pageWidth={1}
                    scrollX={progress}
                    selectedTab={TABS[selected]}
                    onSelect={onChange}
                />
            </View>
        </PlayerBarShell>
    );
}
