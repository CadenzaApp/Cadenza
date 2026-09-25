import { useTheme } from "expo-router/react-navigation";
import { ActivityIndicator, View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import { useTopTagScores } from "@/lib/routes/tags";
import type { Tag, TagSource, TopTagScores } from "@/lib/types";

import { GlassSettingsPanel, SettingsIcon } from "./settings-ui";

/** How many tags the panel shows. */
const TOP_TAG_COUNT = 10;

type TopTag = { tag: Tag; score: number; source: TagSource };

/**
 * The user's `TOP_TAG_COUNT` highest scored tags, highest first, each a tag pill
 * with its score. The user's own tags are solid and default tags are outlined,
 * the same way the player's Tags page tells them apart.
 */
export function TopTagsPanel() {
    const { colors } = useTheme();
    const { topTagScores, topTagScoresErr } = useTopTagScores(TOP_TAG_COUNT);
    const topTags = topTagScores && rankTopTags(topTagScores);

    return (
        <GlassSettingsPanel>
            <View className="gap-4 px-5 py-5">
                <View className="flex-row items-center gap-4">
                    <SettingsIcon name="pricetags-outline" />
                    <View className="flex-1 gap-1">
                        <Text className="text-lg font-semibold">Top Tags</Text>
                        <Text className="text-sm text-muted-foreground">
                            The tags you listen to and search with most.
                        </Text>
                    </View>
                </View>

                {topTags ? (
                    topTags.length === 0 ? (
                        <Text className="text-sm text-muted-foreground">
                            Play tagged songs or run tag queries to see your top
                            tags here.
                        </Text>
                    ) : (
                        <View className="flex-row flex-wrap gap-2">
                            {topTags.map(({ tag, score, source }) => (
                                <TagPill
                                    key={tag.name}
                                    tag={tag}
                                    height={14}
                                    count={score}
                                    inverted={source === "global"}
                                />
                            ))}
                        </View>
                    )
                ) : topTagScoresErr ? (
                    <Text className="text-sm text-muted-foreground">
                        Could not load your top tags.
                    </Text>
                ) : (
                    <ActivityIndicator size="small" color={colors.text} />
                )}
            </View>
        </GlassSettingsPanel>
    );
}

/**
 * The backend's map as a list, highest score first, then by name so ties hold
 * still. Each name becomes a basic tag, since a score has no tag id or type.
 */
function rankTopTags(scores: TopTagScores): TopTag[] {
    return Object.entries(scores)
        .map(([name, [score, color, source]], index) => ({
            tag: { id: -1 - index, name, color, type: "basic" as const },
            score,
            source,
        }))
        .sort(
            (a, b) => b.score - a.score || a.tag.name.localeCompare(b.tag.name),
        );
}
