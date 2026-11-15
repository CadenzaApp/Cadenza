import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Share, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { Button } from "@/components/ui/button";
import { GlassButton } from "@/components/ui/glass-button";
import {
    SegmentedControl,
    type SegmentOption,
} from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import type { CreateInviteBody, Invite } from "@/lib/routes/invites";
import { useAppTheme } from "@/lib/theme";

type Role = "viewer" | "editor";

const ROLES: readonly SegmentOption<Role>[] = [
    { value: "viewer", label: "Viewer" },
    { value: "editor", label: "Editor" },
];

/** `K7PQ4MXZ` as `K7PQ-4MXZ`, for reading only. */
function readable(code: string) {
    return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Shows an invite code big, with Share. The code is selectable, and the share
 * sheet has Copy. For a playlist, `withRole` adds a "Joins as" picker. Each
 * role keeps the code it already loaded, so switching back does not ask again.
 */
export function InviteCodePopup({
    title,
    withRole = false,
    createInvite,
    onClose,
}: {
    title: string;
    withRole?: boolean;
    createInvite: (body: CreateInviteBody) => Promise<Invite>;
    onClose: () => void;
}) {
    const { colors } = useAppTheme();
    const [role, setRole] = useState<Role>("viewer");
    const [attempt, setAttempt] = useState(0);
    const [confirmRegen, setConfirmRegen] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [regenFailed, setRegenFailed] = useState(false);
    // a playlist role remembers the code it loaded, so switching back shows
    // that code instead of asking for another
    const [codes, setCodes] = useState<Partial<Record<Role, Invite>>>({});
    const cached = withRole ? codes[role] : undefined;
    // a result belongs to the request that made it, so a new role or a retry
    // reads as loading until its own result lands
    const requestKey = `${role}:${attempt}`;
    const [result, setResult] = useState<{
        key: string;
        invite?: Invite;
        failed?: boolean;
    } | null>(null);

    useEffect(() => {
        if (cached) return;
        let live = true;
        const key = `${role}:${attempt}`;
        void (async () => {
            try {
                const invite = await createInvite(withRole ? { role } : {});
                if (!live) return;
                if (withRole) setCodes((prev) => ({ ...prev, [role]: invite }));
                setResult({ key, invite });
            } catch {
                if (live) setResult({ key, failed: true });
            }
        })();
        return () => {
            live = false;
        };
        // a role with no code yet, or a retry, asks for one
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [role, attempt, withRole, cached]);

    const current = cached
        ? { invite: cached }
        : result?.key === requestKey
          ? result
          : null;
    const state:
        | { kind: "loading" }
        | { kind: "ready"; invite: Invite }
        | { kind: "error" } = !current
        ? { kind: "loading" }
        : current.invite
          ? { kind: "ready", invite: current.invite }
          : { kind: "error" };

    async function regenerate() {
        setRegenerating(true);
        setRegenFailed(false);
        try {
            const invite = await createInvite(
                withRole ? { role, regenerate: true } : { regenerate: true },
            );
            if (withRole) setCodes((prev) => ({ ...prev, [role]: invite }));
            setResult({ key: requestKey, invite });
            setConfirmRegen(false);
        } catch {
            setRegenFailed(true);
        } finally {
            setRegenerating(false);
        }
    }

    function closeConfirm() {
        if (regenerating) return;
        setRegenFailed(false);
        setConfirmRegen(false);
    }

    async function share(invite: Invite) {
        try {
            await Share.share({
                message: `Join ${title} on Cadenza: ${invite.link} (code ${invite.code})`,
            });
        } catch (error) {
            console.warn("Could not open the share sheet:", error);
        }
    }

    return (
        <>
            <ModalPopup
                visible
                onClose={onClose}
                title={`Invite to ${title}`}
                headerRight={
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Regenerate code"
                        disabled={state.kind !== "ready"}
                        hitSlop={8}
                        onPress={() => {
                            setRegenFailed(false);
                            setConfirmRegen(true);
                        }}
                        className="h-8 w-8 items-center justify-center rounded-full active:opacity-60 disabled:opacity-40"
                    >
                        <Ionicons
                            name="reload"
                            size={18}
                            color={colors.foreground}
                        />
                    </Pressable>
                }
            >
                <View className="gap-4 px-2 pb-2">
                    <View className="h-14 items-center justify-center">
                        {state.kind === "loading" ? (
                            <ActivityIndicator color={colors.foreground} />
                        ) : state.kind === "error" ? (
                            <View className="items-center gap-1">
                                <Text className="text-sm text-muted-foreground">
                                    Couldn&apos;t make a code.
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => {
                                        setCodes((prev) => {
                                            if (!withRole) return prev;
                                            const next = { ...prev };
                                            delete next[role];
                                            return next;
                                        });
                                        setAttempt((n) => n + 1);
                                    }}
                                    className="active:opacity-60"
                                >
                                    <Text className="text-sm font-semibold text-brand">
                                        Try again
                                    </Text>
                                </Pressable>
                            </View>
                        ) : (
                            <Text
                                selectable
                                accessibilityLabel={`Invite code ${state.invite.code.split("").join(" ")}`}
                                className="text-3xl font-bold tracking-widest text-foreground"
                            >
                                {readable(state.invite.code)}
                            </Text>
                        )}
                    </View>
                    {withRole ? (
                        <View className="gap-2">
                            <Text className="text-sm text-muted-foreground">
                                Joins as
                            </Text>
                            <SegmentedControl
                                size="sm"
                                options={ROLES}
                                value={role}
                                onChange={setRole}
                            />
                        </View>
                    ) : null}
                    {state.kind === "ready" && state.invite.expires_at ? (
                        <Text className="text-xs text-muted-foreground">
                            Expires{" "}
                            {new Date(
                                state.invite.expires_at,
                            ).toLocaleDateString()}
                        </Text>
                    ) : null}
                    <GlassButton
                        disabled={state.kind !== "ready"}
                        onPress={() => {
                            if (state.kind === "ready")
                                void share(state.invite);
                        }}
                    >
                        <Text className="font-semibold text-foreground">
                            Share
                        </Text>
                    </GlassButton>
                </View>
            </ModalPopup>
            <ModalPopup
                visible={confirmRegen}
                onClose={closeConfirm}
                title="Regenerate code"
            >
                <View className="gap-4 px-2 pb-2">
                    <Text className="text-sm leading-5 text-muted-foreground">
                        This will invalidate the previous access code
                    </Text>
                    {regenFailed ? (
                        <Text className="text-sm text-destructive">
                            Couldn&apos;t make a new code.
                        </Text>
                    ) : null}
                    <View className="flex-row gap-2">
                        <Button
                            variant="secondary"
                            disabled={regenerating}
                            onPress={closeConfirm}
                            className="flex-1"
                        >
                            <Text>Cancel</Text>
                        </Button>
                        <Button
                            disabled={regenerating}
                            onPress={() => void regenerate()}
                            className="flex-1"
                        >
                            {regenerating ? (
                                <ActivityIndicator
                                    size="small"
                                    color="#ffffff"
                                />
                            ) : (
                                <Text>Regenerate</Text>
                            )}
                        </Button>
                    </View>
                </View>
            </ModalPopup>
        </>
    );
}
