import { createContext, useState } from "react";
import { Pressable, View } from "react-native";
import { OptionPicker } from "@/components/custom/option-picker";
import { TagPill } from "@/components/custom/tag-pill";
import { GlassPill } from "@/components/ui/glass-pill";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
import { withAlpha } from "@/lib/artwork-color";

/** Match PostCard's divider exactly, including light/dark theme changes. */
export function useAdminDivider() {
    return withAlpha(useAppTheme().colors.mutedForeground, 0.55);
}
export const ADMIN_BLACK_OVERLAY = "rgba(0, 0, 0, 0.22)";
export const ScrubContext = createContext<(value: boolean) => void>(() => {});
export function Button({
    label,
    onPress,
    disabled = false,
}: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled}
            accessibilityState={{ disabled }}
            onPress={onPress}
            className="rounded-full bg-muted px-4 py-2 active:opacity-60"
        >
            <Text className="text-sm font-medium">{label}</Text>
        </Pressable>
    );
}
const RANKING_SIZES = [10, 25, 50];
const RANKING_SIZE_SECTIONS = [
    {
        options: RANKING_SIZES.map((n) => ({
            key: String(n),
            label: `Top ${n}`,
        })),
    },
];
export function RankingLimit({
    limit,
    onChange,
}: {
    limit: number;
    onChange: (value: number) => void;
}) {
    const divider = useAdminDivider();
    const [picking, setPicking] = useState(false);
    return (
        <View
            style={{ borderTopColor: divider }}
            className="gap-4 border-t pt-4"
        >
            <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-sm text-muted-foreground">
                    For below, show the
                </Text>
                <GlassPill
                    label={`Top ${limit}`}
                    chevron
                    onPress={() => setPicking(true)}
                />
                <Text className="text-sm text-muted-foreground">results.</Text>
            </View>
            <OptionPicker
                visible={picking}
                title="Ranking size"
                sections={RANKING_SIZE_SECTIONS}
                selectedKey={String(limit)}
                onSelect={(key) => {
                    setPicking(false);
                    onChange(Number(key));
                }}
                onClose={() => setPicking(false)}
            />
        </View>
    );
}
export function Pill({
    label,
    value,
}: {
    label: string;
    value: number | string;
}) {
    const { colors } = useAppTheme();
    return (
        <TagPill
            tag={{ id: 0, name: label, type: "basic", color: colors.brand }}
            count={value}
            height={12}
            showIcon={false}
            appearance="solid"
        />
    );
}
export function Metric({
    label,
    value,
    footer,
}: {
    label: string;
    value: string;
    footer?: string;
}) {
    return (
        <View
            style={{ backgroundColor: ADMIN_BLACK_OVERLAY }}
            className="min-w-0 flex-1 gap-1 rounded-2xl p-4"
        >
            <Text className="text-xs text-muted-foreground">{label}</Text>
            <Text className="text-2xl font-bold">{value}</Text>
            {footer && (
                <Text className="text-xs text-muted-foreground">{footer}</Text>
            )}
        </View>
    );
}
