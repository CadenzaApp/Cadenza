import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import {
    SegmentedControl,
    type SegmentOption,
} from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { useProfile } from "@/lib/routes/profile";
import {
    useLiveSession,
    useLiveSessionWrites,
    useMyLiveSession,
    useStartLiveSession,
    type SessionRole,
} from "@/lib/routes/live-sessions";

import { useSeedSession } from "./use-seed-session";

type Joining = "friends" | "code";

const JOINING: readonly SegmentOption<Joining>[] = [
    { value: "friends", label: "Friends" },
    { value: "code", label: "Code only" },
];

const ROLES: readonly SegmentOption<SessionRole>[] = [
    { value: "listener", label: "Listen" },
    { value: "suggester", label: "Suggest" },
    { value: "queue_editor", label: "Queue" },
    { value: "controller", label: "Control" },
];

const ROLE_HELP: Record<SessionRole, string> = {
    listener: "They see the queue and what is playing.",
    suggester: "They suggest songs. You approve them.",
    queue_editor: "They add, remove, and reorder songs.",
    controller: "They can also play, pause, and skip.",
};

/**
 * Starts a live session, or with `editId` changes one's settings. Music plays
 * on the host's phone, and their current queue becomes the session's.
 */
export function StartSessionScreen({ editId }: { editId?: string }) {
    const router = useRouter();
    const { profile } = useProfile();
    const { mySessionId } = useMyLiveSession();
    const { liveSession: mine } = useLiveSession(mySessionId);
    const { liveSession: editing } = useLiveSession(editId ?? null);
    const { startLiveSession, startLiveSessionLoading } = useStartLiveSession();
    const seedSession = useSeedSession();
    const writes = useLiveSessionWrites(editId ?? "none");

    const alreadyHosting = !editId && mine?.my_role === "host";
    const [name, setName] = useState<string | null>(null);
    const [joining, setJoining] = useState<Joining | null>(null);
    const [role, setRole] = useState<SessionRole | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // the form starts from the session being edited, or sensible defaults
    const nameValue =
        name ??
        editing?.name ??
        (profile?.username ? `${profile.username}'s session` : "My session");
    const joiningValue =
        joining ??
        (editing
            ? editing.allow_join_without_code
                ? "friends"
                : "code"
            : "friends");
    const roleValue = role ?? editing?.default_role ?? "suggester";

    async function submit() {
        setError(null);
        if (alreadyHosting && mySessionId) {
            router.replace("/player");
            return;
        }
        const trimmed = nameValue.trim();
        if (!trimmed) {
            setError("Give it a name.");
            return;
        }
        setSaving(true);
        try {
            if (editId) {
                await writes.updateSession({
                    name: trimmed,
                    default_role: roleValue,
                    allow_join_without_code: joiningValue === "friends",
                });
                router.back();
                return;
            }
            const { session_id } = await startLiveSession({
                name: trimmed,
                default_role: roleValue,
                allow_join_without_code: joiningValue === "friends",
            });
            await seedSession(session_id);
            router.replace("/player");
        } catch {
            setError(
                editId
                    ? "Couldn't save the settings."
                    : "Couldn't start the session.",
            );
        } finally {
            setSaving(false);
        }
    }

    const busy = saving || startLiveSessionLoading;
    const buttonLabel = alreadyHosting
        ? "Open your session"
        : editId
          ? busy
              ? "Saving..."
              : "Save"
          : busy
            ? "Starting..."
            : "Start session";

    return (
        <DetailScreen
            presentation="sheet"
            title={editId ? "Session settings" : "Start a session"}
        >
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-6 px-5 pb-10 pt-2"
                keyboardShouldPersistTaps="handled"
            >
                <Section title="Name">
                    <GlassInput
                        value={nameValue}
                        onChangeText={setName}
                        maxLength={60}
                        editable={!alreadyHosting}
                    />
                </Section>

                <Section title="Who can join">
                    <SegmentedControl
                        size="sm"
                        options={JOINING}
                        value={joiningValue}
                        onChange={setJoining}
                    />
                    <Text className="text-sm leading-5 text-muted-foreground">
                        {joiningValue === "friends"
                            ? "Friends can join from Listening now if your privacy settings allow it. Anyone with a code can join either way."
                            : "Only people you send a code can join."}
                    </Text>
                    {joiningValue === "friends" ? (
                        <Pressable
                            accessibilityRole="link"
                            onPress={() => router.push("/privacy" as Href)}
                            className="self-start active:opacity-60"
                        >
                            <Text className="text-sm font-semibold text-brand">
                                Privacy settings
                            </Text>
                        </Pressable>
                    ) : null}
                </Section>

                <Section title="New people can">
                    <SegmentedControl
                        size="sm"
                        options={ROLES}
                        value={roleValue}
                        onChange={setRole}
                    />
                    <Text className="text-sm text-muted-foreground">
                        {ROLE_HELP[roleValue]}
                    </Text>
                </Section>

                {!editId ? (
                    <Text className="text-sm leading-5 text-muted-foreground">
                        Music plays on this phone. Your current queue becomes
                        the session queue.
                    </Text>
                ) : null}

                <View className="gap-2">
                    <GlassButton disabled={busy} onPress={() => void submit()}>
                        <Text className="font-semibold text-foreground">
                            {buttonLabel}
                        </Text>
                    </GlassButton>
                    {error ? (
                        <Text className="text-sm text-destructive">
                            {error}
                        </Text>
                    ) : null}
                </View>
            </ScrollView>
        </DetailScreen>
    );
}

function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <View className="gap-2">
            <Text className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {title}
            </Text>
            {children}
        </View>
    );
}
