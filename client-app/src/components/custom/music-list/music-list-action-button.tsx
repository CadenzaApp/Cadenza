import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator } from "react-native";
import { useColorScheme } from "nativewind";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

import type { MusicListAction } from "./types";

const ACTION_ICON_SIZE = 20;

type MusicListActionButtonProps<T> = {
    action: MusicListAction<T>;
    target: T;
    onPress?: () => void;
    busy?: boolean;
    disabled?: boolean;
    selected?: boolean;
    toolbar?: boolean;
    className?: string;
};

/** Consistent themed action row used by music-list menus and toolbars. */
export function MusicListActionButton<T>({
    action,
    target,
    onPress,
    busy = false,
    disabled = false,
    selected = false,
    toolbar = false,
    className,
}: MusicListActionButtonProps<T>) {
    const { colorScheme } = useColorScheme();
    const palette = THEME[colorScheme === "dark" ? "dark" : "light"];
    const labelColor = palette[action.labelColor ?? "popoverForeground"];
    const iconColor =
        palette[action.iconColor ?? action.labelColor ?? "popoverForeground"];

    return (
        <Button
            variant={selected ? "secondary" : "ghost"}
            className={cn(
                "rounded-lg",
                toolbar
                    ? "h-auto min-h-10 flex-1 flex-col justify-center gap-0.5 px-2 py-1"
                    : "w-full justify-start",
                className,
            )}
            onPress={
                onPress ??
                (() => {
                    void Promise.resolve(action.onPress(target)).catch(
                        (error) => {
                            console.error(
                                `Music list action failed: ${action.id}`,
                                error,
                            );
                        },
                    );
                })
            }
            disabled={busy || disabled}
            accessibilityLabel={action.label}
            accessibilityState={{ busy, disabled, selected }}
        >
            {busy ? (
                <ActivityIndicator
                    style={{
                        width: ACTION_ICON_SIZE,
                        height: ACTION_ICON_SIZE,
                    }}
                    size="small"
                    color={iconColor}
                />
            ) : action.icon ? (
                <Ionicons
                    name={action.icon}
                    size={ACTION_ICON_SIZE}
                    color={iconColor}
                    style={{
                        width: ACTION_ICON_SIZE,
                        height: ACTION_ICON_SIZE,
                    }}
                />
            ) : null}
            <Text
                className={toolbar ? "w-full flex-none text-center" : "flex-1"}
                style={{ color: labelColor, flexWrap: "wrap" }}
                numberOfLines={toolbar ? undefined : 1}
            >
                {action.label}
            </Text>
        </Button>
    );
}
