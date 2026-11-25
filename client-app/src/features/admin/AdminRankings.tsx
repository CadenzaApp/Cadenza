import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { useOpenScreen } from "@/lib/open-screen";
import { usePost } from "@/lib/routes/social";
import { PostCard } from "@/features/social/PostCard";
import { useAppTheme } from "@/lib/theme";
import {
    useCatalogSearches,
    useTracksForSongIds,
    indexTracksById,
    useArtistsInfo,
} from "@/lib/musickit-hooks";
import { thumbnailArtworkUrl } from "@/lib/artwork";
import { formatDuration } from "@/features/analytics/format";
import type { AdminRankingRow as Row } from "@/lib/routes/admin";
import { Pill, useAdminDivider } from "./admin-ui";
const percent = (value?: number | null) =>
    value == null ? "—" : `${(value * 100).toFixed(1)}%`;
/** Intrinsic text and pill widths choose a single-line side rail only when both fit. */
function RankedItem({
    rank,
    title,
    subtitle,
    artwork,
    children,
    rail,
    forceBelow = false,
}: {
    rank: number;
    title: string;
    subtitle?: string;
    artwork: ReactNode;
    children: ReactNode;
    rail: ReactNode;
    forceBelow?: boolean;
}) {
    const { scheme } = useAppTheme();
    const divider = useAdminDivider();
    const [width, setWidth] = useState(0);
    const [textWidth, setTextWidth] = useState(0);
    const [railWidth, setRailWidth] = useState(0);
    const [artworkWidth, setArtworkWidth] = useState(56);
    const fixed = 32 + (artwork ? artworkWidth + 36 : 24);
    const inline =
        !forceBelow &&
        width > 0 &&
        textWidth > 0 &&
        railWidth > 0 &&
        fixed + textWidth + railWidth <= width;
    return (
        <View
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            style={{ borderBottomColor: divider }}
            className="relative gap-3 border-b py-3"
        >
            <View className="flex-row items-center gap-3">
                <View
                    className={`h-8 w-8 items-center justify-center rounded-full ${scheme === "dark" ? "bg-white" : "bg-black"}`}
                >
                    <Text
                        className={`text-base font-bold ${scheme === "dark" ? "text-black" : "text-white"}`}
                    >
                        {rank}
                    </Text>
                </View>
                {artwork && (
                    <View
                        onLayout={(e) =>
                            setArtworkWidth(e.nativeEvent.layout.width)
                        }
                    >
                        {artwork}
                    </View>
                )}
                <View className="min-w-0 flex-1">{children}</View>
                {inline && <View className="flex-row gap-1.5">{rail}</View>}
            </View>
            {!inline && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerClassName="gap-1.5 py-0.5"
                    accessibilityLabel="Statistics"
                >
                    {rail}
                </ScrollView>
            )}
            <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="absolute left-0 right-0 top-0 opacity-0"
                style={{ height: 0, overflow: "hidden" }}
            >
                <ScrollView horizontal>
                    <View
                        onLayout={(e) =>
                            setTextWidth(e.nativeEvent.layout.width)
                        }
                    >
                        <Text
                            className={
                                forceBelow
                                    ? "text-base font-semibold"
                                    : "font-semibold"
                            }
                        >
                            {title}
                        </Text>
                        {subtitle && (
                            <Text className="text-sm">{subtitle}</Text>
                        )}
                    </View>
                    <View
                        className="flex-row gap-1.5"
                        onLayout={(e) =>
                            setRailWidth(e.nativeEvent.layout.width)
                        }
                    >
                        {rail}
                    </View>
                </ScrollView>
            </View>
        </View>
    );
}
function AdminPost({ id }: { id: number }) {
    const { post, postErr } = usePost(id);
    return post ? (
        <PostCard post={post} />
    ) : (
        <Text className="py-4 text-muted-foreground">
            {postErr ? "Post unavailable" : "Loading post…"}
        </Text>
    );
}
export function Ranking({ title, rows }: { title: string; rows?: Row[] }) {
    const [expanded, setExpanded] = useState(
        [
            "Top posts",
            "Most listened-to artists",
            "Most listened-to tag names",
        ].includes(title),
    );
    const openScreen = useOpenScreen();
    const { colors } = useAppTheme();
    const ids = useMemo(
        () => rows?.flatMap((r) => (r.song_id ? [r.song_id] : [])) ?? [],
        [rows],
    );
    const { tracks } = useTracksForSongIds(ids);
    const byId = useMemo(() => indexTracksById(tracks), [tracks]);
    const terms = useMemo(
        () =>
            rows?.map((r) =>
                title === "Most listened-to artists" && !r.artist_id
                    ? (r.name ?? null)
                    : null,
            ) ?? [],
        [rows, title],
    );
    const { searches } = useCatalogSearches("artists", terms);
    const artistIds = useMemo(
        () =>
            title === "Most listened-to artists"
                ? (rows?.flatMap((row, i) => {
                      const a = searches?.[i]?.artists.find(
                          (a) =>
                              a.name.toLowerCase().trim() ===
                              row.name?.toLowerCase().trim(),
                      );
                      const id = row.artist_id ?? a?.catalogId ?? a?.id;
                      return id ? [id] : [];
                  }) ?? [])
                : [],
        [rows, searches, title],
    );
    const { artists } = useArtistsInfo(artistIds);

    return (
        <View className="gap-3">
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpanded(!expanded)}
                className="flex-row items-center justify-between py-2"
            >
                <Text className="text-lg font-bold">{title}</Text>
                <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.foreground}
                />
            </Pressable>
            {expanded && !rows?.length && (
                <Text className="py-4 text-sm text-muted-foreground">
                    No activity in this period.
                </Text>
            )}
            {expanded &&
                rows?.map((row, i) => {
                    const track = row.song_id
                        ? byId.get(row.song_id)
                        : undefined;
                    const found = searches?.[i]?.artists.find(
                        (a) =>
                            a.name.toLowerCase().trim() ===
                            row.name?.toLowerCase().trim(),
                    );
                    const artistId =
                        row.artist_id ?? found?.catalogId ?? found?.id;
                    if (row.post_id)
                        return <AdminPost key={row.post_id} id={row.post_id} />;
                    const pills: { label: string; value: number | string }[] =
                        title === "The songs nobody likes"
                            ? [
                                  { label: "Skips", value: row.skips ?? 0 },
                                  { label: "Plays", value: row.plays ?? 0 },
                                  {
                                      label: "Skip",
                                      value: percent(row.skip_rate),
                                  },
                                  {
                                      label: "Early skip",
                                      value: percent(row.early_skip_rate),
                                  },
                              ]
                            : [
                                  ...(row.plays != null
                                      ? [{ label: "Plays", value: row.plays }]
                                      : []),
                                  ...(row.listeners != null
                                      ? [
                                            {
                                                label: "Listeners",
                                                value: row.listeners,
                                            },
                                        ]
                                      : []),
                                  ...(row.listening_ms != null
                                      ? [
                                            {
                                                label: "Time",
                                                value: formatDuration(
                                                    row.listening_ms,
                                                ),
                                            },
                                        ]
                                      : []),
                                  ...(row.likes != null
                                      ? [{ label: "Likes", value: row.likes }]
                                      : []),
                              ];
                    const displayTitle =
                        track?.title ??
                        row.name ??
                        row.content ??
                        row.song_id ??
                        "Unknown";
                    const subtitle = row.song_id
                        ? (track?.artistName ??
                          row.artist_name ??
                          "Unknown artist")
                        : undefined;
                    const artist =
                        artists.find(
                            (a) =>
                                a.id === artistId || a.catalogId === artistId,
                        ) ?? found;
                    const artwork = row.song_id ? (
                        <RemoteArtwork
                            url={thumbnailArtworkUrl(track?.artworkUrl)}
                            className="h-14 w-14 rounded-lg bg-muted"
                            fallback={
                                <Ionicons
                                    name="musical-note"
                                    size={22}
                                    color={colors.mutedForeground}
                                />
                            }
                        />
                    ) : title === "Most listened-to artists" ? (
                        <RemoteArtwork
                            url={thumbnailArtworkUrl(artist?.artworkUrl)}
                            className="h-10 w-10 rounded-full bg-muted"
                            fallback={
                                <Ionicons
                                    name="person"
                                    size={20}
                                    color={colors.mutedForeground}
                                />
                            }
                        />
                    ) : null;
                    return (
                        <RankedItem
                            key={`${row.song_id ?? row.name}-${i}`}
                            rank={i + 1}
                            title={displayTitle}
                            subtitle={subtitle}
                            artwork={artwork}
                            forceBelow={!row.song_id}
                            rail={pills.map(({ label, value }) => (
                                <Pill key={label} label={label} value={value} />
                            ))}
                        >
                            <Pressable
                                disabled={!row.song_id && !artistId}
                                accessibilityRole="button"
                                onPress={() =>
                                    openScreen(
                                        {
                                            pathname: row.song_id
                                                ? "/discuss/[songId]"
                                                : "/artist/[id]",
                                            params: {
                                                id: artistId ?? "",
                                                songId: row.song_id ?? "",
                                                name: row.name ?? "",
                                            },
                                        },
                                        { closing: "admin" },
                                    )
                                }
                                className="gap-1.5"
                            >
                                <Text
                                    numberOfLines={row.content ? 5 : 2}
                                    className={
                                        row.song_id
                                            ? "font-semibold"
                                            : "text-base font-semibold"
                                    }
                                >
                                    {track?.title ??
                                        row.name ??
                                        row.content ??
                                        row.song_id}
                                </Text>
                                {row.song_id && (
                                    <Text
                                        numberOfLines={1}
                                        className="text-sm text-muted-foreground"
                                    >
                                        {track?.artistName ??
                                            row.artist_name ??
                                            "Unknown artist"}
                                    </Text>
                                )}
                            </Pressable>
                        </RankedItem>
                    );
                })}
        </View>
    );
}
