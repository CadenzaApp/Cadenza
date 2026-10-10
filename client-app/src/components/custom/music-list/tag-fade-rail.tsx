import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useMemo } from "react";
import { ScrollView, View } from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";

import { TagPill } from "@/components/custom/tag-pill";
import { activityTagDisplayValue, unownedDefaultTags } from "@/lib/tag-values";
import type { AppliedTag, Tag, TagMetadata } from "@/lib/types";

import { sortMusicListTags } from "./sort-tags";

const TAG_RAIL_TOUCH_INSET = 10;
const EMPTY_TAG_NAMES: readonly string[] = [];
const SUGGESTED_TAG_STYLE = { opacity: 0.42 } as const;
const FILL = {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
} as const;
const MASK_ROW = { ...FILL, flexDirection: "row" } as const;
const MASK_SOLID = { flex: 1, backgroundColor: "black" } as const;
const MASK_COVER = { ...FILL, backgroundColor: "black" } as const;

/**
 * The song's own and shared default tags in list-wide relevance order.
 * Defaults stay unfilled so their source remains visible after sorting.
 * Activity tags come first when given, since a list only passes the ones its
 * query filters on, each with the song's value ("My Plays 3").
 */
export const TagFadeRail = memo(function TagFadeRail({
    tags,
    defaultTags = [],
    mostRelevantTags,
    tagMetadata,
    activityTags = [],
    compact,
}: {
    tags: readonly AppliedTag[];
    defaultTags?: readonly Tag[];
    mostRelevantTags?: readonly string[];
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
    /** Already narrowed to the ones to show, in order. */
    activityTags?: readonly AppliedTag[];
    compact: boolean;
}) {
    const shownDefaultTags = useMemo(
        () => unownedDefaultTags(defaultTags, tags),
        [defaultTags, tags],
    );
    const orderedTags = useMemo(
        () =>
            sortMusicListTags(
                tags,
                shownDefaultTags,
                mostRelevantTags ?? EMPTY_TAG_NAMES,
                tagMetadata,
            ),
        [mostRelevantTags, shownDefaultTags, tagMetadata, tags],
    );
    const fadeWidth = compact ? 16 : 24;
    // measured into shared values, not state, so laying out never renders the
    // rail again; the UI thread alone decides whether the fade shows
    const viewportWidth = useSharedValue(0);
    const contentWidth = useSharedValue(0);
    const coverStyle = useAnimatedStyle(() => {
        const overflows =
            viewportWidth.get() > 0 &&
            contentWidth.get() - fadeWidth > viewportWidth.get();
        return { opacity: overflows ? 0 : 1 };
    });
    // a solid strip with a fixed width fade at its end. the cover over it is
    // solid too, and hides the fade whenever the tags fit
    const maskElement = (
        <View style={MASK_ROW}>
            <View style={MASK_SOLID} />
            <LinearGradient
                style={{ width: fadeWidth }}
                colors={["black", "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
            />
            <Animated.View style={[MASK_COVER, coverStyle]} />
        </View>
    );

    return (
        <View
            // The negative margin preserves the row's exact layout while the
            // vertical content padding gives the ScrollView a real, larger
            // native touch surface above and below the visible pills.
            style={{
                alignSelf: "stretch",
                marginVertical: -TAG_RAIL_TOUCH_INSET,
                zIndex: 2,
            }}
            onLayout={(event) =>
                viewportWidth.set(event.nativeEvent.layout.width)
            }
        >
            <MaskedView
                style={{ alignSelf: "stretch" }}
                maskElement={maskElement}
            >
                <ScrollView
                    horizontal
                    directionalLockEnabled
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    onContentSizeChange={(width) => contentWidth.set(width)}
                    contentContainerStyle={{
                        gap: compact ? 4 : 6,
                        // always room for the fade, so the last tag can be
                        // scrolled clear of it without a layout change
                        paddingRight: fadeWidth,
                        paddingVertical: TAG_RAIL_TOUCH_INSET,
                    }}
                >
                    {activityTags.map((tag) => (
                        <TagPill
                            key={`activity:${tag.id}`}
                            tag={tag}
                            value={activityTagDisplayValue(tag)}
                            height={compact ? 8 : 9}
                            showIcon={false}
                        />
                    ))}
                    {orderedTags.map(({ source, tag }) => (
                        <View
                            key={`${source}:${tag.id}`}
                            style={
                                source === "default"
                                    ? SUGGESTED_TAG_STYLE
                                    : null
                            }
                        >
                            <TagPill
                                tag={tag}
                                value={
                                    source === "local" ? tag.value : undefined
                                }
                                height={compact ? 8 : 9}
                                showIcon={false}
                                suggested={source === "default"}
                            />
                        </View>
                    ))}
                </ScrollView>
            </MaskedView>
        </View>
    );
});
