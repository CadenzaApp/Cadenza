import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { MusicListActionButton } from "@/components/custom/music-list/music-list-action-button";
import type { MusicListAction } from "@/components/custom/music-list/types";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";

import { initialsFromUsername } from "./format";

/** An initials circle. There are no profile photos. */
export function Initials({
    username,
    size = 40,
    online = false,
}: {
    username: string;
    size?: number;
    /** A green dot in the bottom right: the app open, or playing now. */
    online?: boolean;
}) {
    // a quarter of the avatar, never smaller than the border can ring
    const dot = Math.max(10, Math.round(size / 4));
    return (
        <View style={{ width: size, height: size }}>
            <View
                className="flex-1 items-center justify-center rounded-full border-2 border-background bg-muted"
                importantForAccessibility="no-hide-descendants"
            >
                <Text
                    className="font-semibold text-foreground"
                    style={{ fontSize: Math.max(9, size * 0.32) }}
                >
                    {initialsFromUsername(username)}
                </Text>
            </View>
            {online ? (
                <View
                    accessibilityLabel="Online"
                    className="absolute bottom-0 right-0 rounded-full border-2 border-background bg-success"
                    style={{ width: dot, height: dot }}
                />
            ) : null}
        </View>
    );
}

/**
 * One person in a playlist or a session. A manager can tap it for the role
 * menu; for everyone else it opens their profile through `onPress`.
 */
export function MemberRow({
    username,
    isYou,
    roleLabel,
    subtitle,
    subtitleIcon,
    manageable,
    onPress,
    trailing,
}: {
    username: string;
    isYou?: boolean;
    roleLabel: string;
    subtitle?: string;
    subtitleIcon?: IoniconName;
    /** Shows the chevron and labels the row as changeable. */
    manageable?: boolean;
    onPress?: () => void;
    trailing?: ReactNode;
}) {
    const { mutedForeground } = useAppTheme().colors;
    const name = isYou ? `${username} (you)` : username;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={
                manageable ? `${name}, ${roleLabel}. Change role` : name
            }
            disabled={!onPress}
            onPress={onPress}
            className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
        >
            <Initials username={username} />
            <View className="min-w-0 flex-1">
                <Text
                    className="font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {name}
                </Text>
                {subtitle ? (
                    <View className="flex-row items-center gap-1">
                        {subtitleIcon ? (
                            <Ionicons
                                name={subtitleIcon}
                                size={12}
                                color={mutedForeground}
                            />
                        ) : null}
                        <Text
                            className="text-xs text-muted-foreground"
                            numberOfLines={1}
                        >
                            {subtitle}
                        </Text>
                    </View>
                ) : null}
            </View>
            {trailing ?? (
                <View className="flex-row items-center gap-1">
                    <Text className="text-sm text-muted-foreground">
                        {roleLabel}
                    </Text>
                    {manageable ? (
                        <Ionicons
                            name="chevron-down"
                            size={14}
                            color={mutedForeground}
                        />
                    ) : null}
                </View>
            )}
        </Pressable>
    );
}

/** A role a member can be set to, as the role menu lists it. */
export type RoleChoice<T extends string> = { value: T; label: string };

/**
 * Pick a member's role, view them, or remove them. Shared by playlist members
 * and session people.
 */
export function RoleMenu<T extends string>({
    username,
    roles,
    current,
    removeLabel,
    onPick,
    onViewProfile,
    onRemove,
    onClose,
}: {
    username: string;
    roles: readonly RoleChoice<T>[];
    current: T;
    removeLabel: string;
    onPick: (role: T) => void;
    onViewProfile: () => void;
    onRemove: () => void;
    onClose: () => void;
}) {
    function action(
        id: string,
        label: string,
        onPress: () => void,
        icon?: IoniconName,
        destructive = false,
    ): MusicListAction<null> {
        return {
            id,
            label,
            icon,
            ...(destructive
                ? { labelColor: "destructive", iconColor: "destructive" }
                : {}),
            onPress: () => {
                onClose();
                onPress();
            },
        };
    }

    return (
        <ModalPopup visible onClose={onClose} title={username}>
            {roles.map((role) => (
                <MusicListActionButton
                    key={role.value}
                    action={action(
                        `role-${role.value}`,
                        role.label,
                        () => onPick(role.value),
                        role.value === current ? "checkmark" : undefined,
                    )}
                    target={null}
                    selected={role.value === current}
                />
            ))}
            <View className="my-1 h-px bg-border" />
            <MusicListActionButton
                action={action(
                    "view-profile",
                    "View profile",
                    onViewProfile,
                    "person-outline",
                )}
                target={null}
            />
            <MusicListActionButton
                action={action(
                    "remove",
                    removeLabel,
                    onRemove,
                    "person-remove-outline",
                    true,
                )}
                target={null}
            />
        </ModalPopup>
    );
}
