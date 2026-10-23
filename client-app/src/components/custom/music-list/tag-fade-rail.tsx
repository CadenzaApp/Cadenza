import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { activityTagDisplayValue, unownedDefaultTags } from "@/lib/tag-values";
import type { AppliedTag, Tag, TagMetadata } from "@/lib/types";

import {
    leadPillFirst,
    sortMusicListTags,
    type RailLead,
    type RailPillSource,
} from "./sort-tags";

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

/** One pill on the rail, with the value it shows. */
type RailPill = {
    source: RailPillSource;
    tag: Tag | AppliedTag;
    value?: string | null;
};

/**
 * The song's own and shared default tags in list-wide relevance order.
 * Defaults stay unfilled so their source remains visible after sorting.
 * Activity tags come first when given, since a list only passes the ones its
 * query filters on, each with the song's value ("My Plays 3").
 *
 * A list sorted by a tag passes it as `lead`, and it goes first of all, so
 * the value the list is sorted by is always in view.
 */
export const TagFadeRail = memo(function TagFadeRail({
    tags,
    defaultTags = [],
    mostRelevantTags,
    tagMetadata,
    activityTags = [],
    lead,
    compact,
}: {
    tags: readonly AppliedTag[];
    defaultTags?: readonly Tag[];
    mostRelevantTags?: readonly string[];
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
    /** Already narrowed to the ones to show, in order. */
    activityTags?: readonly AppliedTag[];
    /** The tag the list is sorted by, shown first. */
    lead?: RailLead;
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
    const pills = useMemo(() => {
        const all: RailPill[] = [
            ...activityTags.map(
                (tag): RailPill => ({
                    source: "activity",
                    tag,
                    value: activityTagDisplayValue(tag),
                }),
            ),
            ...orderedTags.map(
                ({ source, tag }): RailPill =>
                    source === "local"
                        ? { source: "own", tag, value: tag.value }
                        : { source: "suggested", tag },
            ),
        ];
        if (lead?.kind === "pill") {
            return [
                { source: "lead", tag: lead.tag, value: lead.value } as const,
                ...all,
            ];
        }
        return leadPillFirst(all, lead);
    }, [activityTags, lead, orderedTags]);
    const fadeWidth = compact ? 16 : 24;
    // only a rail whose tags run past its edge gets the mask: a mask makes
    // iOS draw the row offscreen, every frame it moves. the widths live in
    // refs and only the yes or no is state, so a rail renders again at most
    // once, when that answer changes
    const widths = useRef({ viewport: 0, content: 0 });
    const [overflows, setOverflows] = useState(false);
    const remeasure = () => {
        const { viewport, content } = widths.current;
        setOverflows(viewport > 0 && content - fadeWidth > viewport);
    };

    const rail = (
        <ScrollView
            horizontal
            directionalLockEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onContentSizeChange={(width) => {
                widths.current.content = width;
                remeasure();
            }}
            contentContainerStyle={{
                gap: compact ? 4 : 6,
                // always room for the fade, so the last tag can be scrolled
                // clear of it without a layout change
                paddingRight: fadeWidth,
                paddingVertical: TAG_RAIL_TOUCH_INSET,
            }}
        >
            {pills.map(({ source, tag, value }) => (
                <View
                    key={`${source}:${tag.id}`}
                    style={source === "suggested" ? SUGGESTED_TAG_STYLE : null}
                >
                    <TagPill
                        tag={tag}
                        value={value}
                        height={compact ? 8 : 9}
                        showIcon={false}
                        suggested={source === "suggested"}
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
                widths.current.viewport = event.nativeEvent.layout.width;
                remeasure();
            }}
        >
            {overflows ? (
                <MaskedView
                    style={{ alignSelf: "stretch" }}
                    maskElement={
                        <View style={MASK_ROW}>
                            <View style={MASK_SOLID} />
                            <LinearGradient
                                style={{ width: fadeWidth }}
                                colors={["black", "transparent"]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                            />
                        </View>
                    }
                >
                    {rail}
                </MaskedView>
            ) : (
                rail
            )}
        </View>
    );
});
