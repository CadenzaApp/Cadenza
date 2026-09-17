import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { unownedDefaultTags } from "@/lib/tag-values";
import type { AppliedTag, Tag } from "@/lib/types";

import { tagFadeStart } from "./tag-fade-utils";

/**
 * The song's own tags, then the shared default tags on it. Defaults are
 * unfilled, so a row reads as "mine first, the crowd's after".
 */
export function TagFadeRail({
    tags,
    defaultTags = [],
    compact,
}: {
    tags: AppliedTag[];
    defaultTags?: Tag[];
    compact: boolean;
}) {
    const shownDefaultTags = useMemo(
        () => unownedDefaultTags(defaultTags, tags),
        [defaultTags, tags],
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
            style={{ alignSelf: "stretch" }}
            onLayout={(event) =>
                setViewportWidth(event.nativeEvent.layout.width)
            }
            maskElement={maskElement}
        >
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                onContentSizeChange={(width) => setContentWidth(width)}
                contentContainerStyle={{
                    gap: compact ? 4 : 6,
                    paddingRight: fadeWidth,
                }}
            >
                {tags.map((tag) => (
                    <TagPill
                        key={tag.id}
                        tag={tag}
                        value={tag.value}
                        height={compact ? 8 : 9}
                        showIcon={false}
                    />
                ))}
                {shownDefaultTags.map((tag) => (
                    <TagPill
                        key={`default:${tag.id}`}
                        tag={tag}
                        height={compact ? 8 : 9}
                        showIcon={false}
                        inverted
                    />
                ))}
            </ScrollView>
        </MaskedView>
    );
}
