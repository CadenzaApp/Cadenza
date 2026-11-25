import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassPill } from "@/components/ui/glass-pill";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useAppTheme } from "@/lib/theme";
import {
    useAdminAccess,
    useRoleAccess,
    useChangeRole,
    type PlatformRole,
} from "@/lib/routes/admin";

const LABELS: Record<PlatformRole, string> = {
    user: "Normal user",
    moderator: "Moderator",
    admin: "Admin",
    owner: "Owner",
};
const RANK: Record<PlatformRole, number> = {
    user: 0,
    moderator: 1,
    admin: 2,
    owner: 3,
};
type Selection = { userId: string; from: PlatformRole; to: PlatformRole };

function accessChange(from: PlatformRole, to: PlatformRole) {
    if (to === "admin")
        return "Gives access to platform statistics and permission to appoint or remove moderators.";
    if (from === "admin")
        return `Removes access to platform statistics and moderator management.${to === "moderator" ? " Moderators have no extra permissions yet." : ""}`;
    if (to === "moderator")
        return "Assigns Moderator status. Moderators have no extra permissions yet.";
    return "Removes Moderator status. Regular account access stays the same.";
}

export function RoleControls({ userId }: { userId: string }) {
    const { account } = useAccount();
    const { colors } = useAppTheme();
    const access = useAdminAccess();
    const enabled =
        !!access.data?.dashboard && !access.error && account?.id !== userId;
    const target = useRoleAccess(userId, enabled);
    const change = useChangeRole(userId);
    const [message, setMessage] = useState<string | null>(null);
    const [openFor, setOpenFor] = useState<string | null>(null);
    const [selection, setSelection] = useState<Selection | null>(null);
    if (!enabled || target.error || !target.data?.allowed_roles.length)
        return null;
    const current = target.data.role;
    const pending = selection?.userId === userId ? selection : null;
    const verb =
        pending && RANK[pending.to] < RANK[pending.from] ? "Demote" : "Promote";
    const close = () => {
        if (change.isMutating) return;
        setOpenFor(null);
        setSelection(null);
        setMessage(null);
    };
    async function save() {
        if (!pending || change.isMutating) return;
        setMessage(null);
        try {
            await change.trigger({
                role: pending.to,
                expected_role: pending.from,
            });
            setOpenFor(null);
            setSelection(null);
        } catch {
            setMessage(
                "Role change failed. Close this dialog and refresh the profile before trying again.",
            );
        }
    }
    const roles = [...new Set([current, ...target.data.allowed_roles])];
    return (
        <View className="flex-row items-center justify-between gap-3 py-3">
            <Text className="text-sm font-semibold">Platform role</Text>
            <GlassPill
                label={LABELS[current]}
                chevron
                disabled={change.isMutating}
                accessibilityLabel={`Platform role: ${LABELS[current]}. Change role`}
                onPress={() => {
                    setMessage(null);
                    setSelection(null);
                    setOpenFor(userId);
                }}
            />
            <ModalPopup
                visible={openFor === userId}
                onClose={close}
                title={
                    pending
                        ? `${verb} to ${LABELS[pending.to]}?`
                        : "Platform role"
                }
            >
                {pending ? (
                    <View className="gap-5">
                        <Text className="leading-6 text-muted-foreground">
                            {verb} this user from {LABELS[pending.from]} to{" "}
                            {LABELS[pending.to]}.{" "}
                            {accessChange(pending.from, pending.to)}
                        </Text>
                        {message && (
                            <Text
                                accessibilityRole="alert"
                                className="text-sm text-destructive"
                            >
                                {message}
                            </Text>
                        )}
                        <View className="gap-3">
                            <GlassButton
                                disabled={change.isMutating}
                                onPress={() => void save()}
                            >
                                <Text>
                                    {change.isMutating
                                        ? "Changing role…"
                                        : `${verb} to ${LABELS[pending.to]}`}
                                </Text>
                            </GlassButton>
                            <GlassButton
                                disabled={change.isMutating}
                                onPress={close}
                            >
                                <Text>Cancel</Text>
                            </GlassButton>
                        </View>
                    </View>
                ) : (
                    roles.map((role) => (
                        <Pressable
                            key={role}
                            accessibilityRole="button"
                            accessibilityState={{ selected: role === current }}
                            onPress={() => {
                                if (role === current) {
                                    close();
                                    return;
                                }
                                setSelection({
                                    userId,
                                    from: current,
                                    to: role,
                                });
                            }}
                            className="min-h-11 flex-row items-center justify-between gap-3 py-2 active:opacity-60"
                        >
                            <Text
                                className={
                                    role === current
                                        ? "text-base font-semibold"
                                        : "text-base"
                                }
                            >
                                {LABELS[role]}
                            </Text>
                            {role === current && (
                                <Ionicons
                                    name="checkmark"
                                    size={18}
                                    color={colors.foreground}
                                />
                            )}
                        </Pressable>
                    ))
                )}
            </ModalPopup>
        </View>
    );
}
