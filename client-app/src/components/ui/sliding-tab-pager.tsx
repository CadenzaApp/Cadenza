import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, {
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { withAlpha } from "@/lib/artwork-color";
import { ScreenPagerPageContext } from "@/lib/screen-pager";
import { useAppTheme } from "@/lib/theme";

export type SlidingTabOption<T extends string> = { value: T; label: string };

/** A stationary underline selector above always-mounted, finger-following pages. */
export function SlidingTabPager<T extends string>({
    options,
    value,
    onChange,
    renderPage,
    topInset = 0,
}: {
    options: readonly SlidingTabOption<T>[];
    value: T;
    onChange: (value: T) => void;
    renderPage: (value: T) => ReactNode;
    topInset?: number;
}) {
    const pager = useRef<ScrollView>(null);
    const { width: windowWidth } = useWindowDimensions();
    const [layoutWidth, setLayoutWidth] = useState(0);
    const pageWidth = layoutWidth || windowWidth;
    const index = Math.max(
        0,
        options.findIndex((option) => option.value === value),
    );
    const [initialOffset] = useState(() => ({ x: index * windowWidth, y: 0 }));
    const previousWidth = useRef(pageWidth);
    const progress = useSharedValue(index);

    useEffect(() => {
        pager.current?.scrollTo({
            x: index * pageWidth,
            animated: previousWidth.current === pageWidth,
        });
        previousWidth.current = pageWidth;
    }, [index, pageWidth]);

    const onScroll = useAnimatedScrollHandler((event) => {
        progress.set(event.contentOffset.x / pageWidth);
    });

    return (
        <View className="flex-1" style={{ paddingTop: topInset }}>
            <View className="px-5 pb-2">
                <SlidingTabStrip
                    options={options}
                    value={value}
                    onChange={onChange}
                    progress={progress}
                />
            </View>
            <Animated.ScrollView
                ref={pager}
                className="flex-1"
                horizontal
                pagingEnabled
                bounces={false}
                directionalLockEnabled
                removeClippedSubviews={false}
                showsHorizontalScrollIndicator={false}
                keyboardDismissMode="on-drag"
                contentOffset={initialOffset}
                onLayout={(event) =>
                    setLayoutWidth(event.nativeEvent.layout.width)
                }
                onScroll={onScroll}
                scrollEventThrottle={16}
                onMomentumScrollEnd={(event) => {
                    const next =
                        options[
                            Math.max(
                                0,
                                Math.min(
                                    options.length - 1,
                                    Math.round(
                                        event.nativeEvent.contentOffset.x /
                                            pageWidth,
                                    ),
                                ),
                            )
                        ];
                    if (next && next.value !== value) onChange(next.value);
                }}
            >
                {options.map((option) => (
                    <View
                        key={option.value}
                        style={{ width: pageWidth }}
                        accessibilityElementsHidden={value !== option.value}
                        importantForAccessibility={
                            value === option.value
                                ? "auto"
                                : "no-hide-descendants"
                        }
                    >
                        <ScreenPagerPageContext.Provider
                            value={{
                                active: value === option.value,
                                topInset: 0,
                                keepRailVisible: true,
                            }}
                        >
                            {renderPage(option.value)}
                        </ScreenPagerPageContext.Provider>
                    </View>
                ))}
            </Animated.ScrollView>
        </View>
    );
}

/** Shared stationary tabs for a pager or a separately scrolling feed header. */
export function SlidingTabStrip<T extends string>({
    options,
    value,
    onChange,
    progress,
}: {
    options: readonly SlidingTabOption<T>[];
    value: T;
    onChange: (value: T) => void;
    progress: SharedValue<number>;
}) {
    const [tabWidth, setTabWidth] = useState(0);
    const { mutedForeground } = useAppTheme().colors;
    const underlineStyle = useAnimatedStyle(() => ({
        width: tabWidth / options.length,
        transform: [
            {
                translateX:
                    (Math.max(0, Math.min(options.length - 1, progress.get())) *
                        tabWidth) /
                    options.length,
            },
        ],
    }));

    return (
        <View
            className="flex-row border-b pb-1"
            style={{
                borderBottomColor: withAlpha(mutedForeground, 0.55),
            }}
            onLayout={(event) => setTabWidth(event.nativeEvent.layout.width)}
        >
            {options.map((option) => (
                <Pressable
                    key={option.value}
                    className="flex-1"
                    accessibilityRole="tab"
                    accessibilityState={{
                        selected: value === option.value,
                    }}
                    onPress={() => onChange(option.value)}
                >
                    <Text
                        selectable={false}
                        className={
                            value === option.value
                                ? "py-3 text-center font-semibold text-foreground"
                                : "py-3 text-center font-semibold text-muted-foreground"
                        }
                    >
                        {option.label}
                    </Text>
                </Pressable>
            ))}
            <Animated.View
                pointerEvents="none"
                className="absolute bottom-0 left-0 h-1 rounded-full bg-brand"
                style={underlineStyle}
            />
        </View>
    );
}
