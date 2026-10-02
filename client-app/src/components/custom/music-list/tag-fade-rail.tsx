import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { activityTagDisplayValue, unownedDefaultTags } from "@/lib/tag-values";
import type { AppliedTag, Tag, TagMetadata } from "@/lib/types";

import { tagFadeStart } from "./tag-fade-utils";
import { sortMusicListTags } from "./sort-tags";

const TAG_RAIL_TOUCH_INSET = 10;
const EMPTY_TAG_NAMES: readonly string[] = [];
const SUGGESTED_TAG_STYLE = { opacity: 0.42 } as const;

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
    const [viewportWidth, setViewportWidth] = useState(0);
    const [contentWidth, setContentWidth] = useState(0);
    const fadeWidth = compact ? 16 : 24;
    const overflows = contentWidth > viewportWidth && viewportWidth > 0;
    const maskElement = overflows ? (
        <LinearGradient
            style={StyleSheet.absoluteFill}
            colors={["black", "black", "transparent"]}
            locations={[0, tagFadeStart(viewportWidth, fadeWidth), 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
        />
    ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "black" }]} />
    );

    const rail = (
        <ScrollView
            horizontal
            directionalLockEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onContentSizeChange={(width) =>
                setContentWidth((current) =>
                    current === width ? current : width,
                )
            }
            contentContainerStyle={{
                gap: compact ? 4 : 6,
                paddingRight: overflows ? fadeWidth : 0,
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
                    style={source === "default" ? SUGGESTED_TAG_STYLE : null}
                >
                    <TagPill
                        tag={tag}
                        value={source === "local" ? tag.value : undefined}
                        height={compact ? 8 : 9}
                        showIcon={false}
                        suggested={source === "default"}
                    />
                </View>
            ))}
        </ScrollView>
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
            onLayout={(event) => {
                const width = event.nativeEvent.layout.width;
                setViewportWidth((current) =>
                    current === width ? current : width,
                );
            }}
        >
            {overflows ? (
                <MaskedView
                    style={{ alignSelf: "stretch" }}
                    maskElement={maskElement}
                >
                    {rail}
                </MaskedView>
            ) : (
                rail
            )}
        </View>
    );
});
