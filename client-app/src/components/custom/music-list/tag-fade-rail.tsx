import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { unownedDefaultTags } from "@/lib/tag-values";
import type { AppliedTag, Tag, TagMetadata } from "@/lib/types";

import { tagFadeStart } from "./tag-fade-utils";
import { sortMusicListTags } from "./sort-tags";

const TAG_RAIL_TOUCH_INSET = 10;
const EMPTY_TAG_NAMES: readonly string[] = [];

/**
 * The song's own and shared default tags in list-wide relevance order.
 * Defaults stay unfilled so their source remains visible after sorting.
 */
export function TagFadeRail({
    tags,
    defaultTags = [],
    mostRelevantTags,
    tagMetadata,
    compact,
}: {
    tags: AppliedTag[];
    defaultTags?: Tag[];
    mostRelevantTags?: readonly string[];
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
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

    return (
        <MaskedView
            // The negative margin preserves the row's exact layout while the
            // vertical content padding gives the ScrollView a real, larger
            // native touch surface above and below the visible pills.
            style={{
                alignSelf: "stretch",
                marginVertical: -TAG_RAIL_TOUCH_INSET,
            }}
            onLayout={(event) =>
                setViewportWidth(event.nativeEvent.layout.width)
            }
            maskElement={maskElement}
        >
            <ScrollView
                horizontal
                directionalLockEnabled
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                onContentSizeChange={(width) => setContentWidth(width)}
                contentContainerStyle={{
                    gap: compact ? 4 : 6,
                    paddingRight: fadeWidth,
                    paddingVertical: TAG_RAIL_TOUCH_INSET,
                }}
            >
                {orderedTags.map(({ source, tag }) => (
                    <View
                        key={`${source}:${tag.id}`}
                        style={source === "default" ? { opacity: 0.58 } : null}
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
        </MaskedView>
    );
}
