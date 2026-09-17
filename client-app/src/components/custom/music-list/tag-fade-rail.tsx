import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import type { AppliedTag } from "@/lib/types";

import { tagFadeStart } from "./tag-fade-utils";

export function TagFadeRail({
    tags,
    compact,
}: {
    tags: AppliedTag[];
    compact: boolean;
}) {
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
            </ScrollView>
        </MaskedView>
    );
}
