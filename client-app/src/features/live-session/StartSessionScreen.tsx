import { useRouter, type Href } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassToggle } from "@/components/ui/glass-toggle";
import {
    SegmentedControl,
    type SegmentOption,
} from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { useProfile } from "@/lib/routes/profile";
import {
    showsAsLive,
    useLiveSessionWrites,
    useStartLiveSession,
    type SessionRole,
} from "@/lib/routes/live-sessions";

import { useCurrentLiveSession } from "./use-current-session";
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
 * `/live-session/new`, a sheet. Starts a live session, or with `editing`
 * changes the caller's session settings. Music plays on the host's phone, and
 * their current queue becomes the session's. A quiet listen along session the
 * caller hosts is turned into a regular one instead of starting another, so
 * its listeners stay. `openPlayer` opens the player after a start, for a start
 * from outside it.
 */
export function StartSessionScreen({
    editing = false,
    openPlayer = false,
}: {
    editing?: boolean;
    openPlayer?: boolean;
}) {
    const router = useRouter();
    const { profile } = useProfile();
    const mine = useCurrentLiveSession();
    const hosting = mine?.my_role === "host" ? mine : null;
    const current = editing ? hosting : null;
    // a listen along session nobody joined becomes the new one
    const quiet = hosting && !showsAsLive(hosting) ? hosting : null;
    const target = current ?? quiet;
    const { startLiveSession } = useStartLiveSession();
    const seedSession = useSeedSession();
    const writes = useLiveSessionWrites(target?.session_id ?? "none");

    const [name, setName] = useState<string | null>(null);
    const [joining, setJoining] = useState<Joining | null>(null);
    const [role, setRole] = useState<SessionRole | null>(null);
    const [approve, setApprove] = useState<boolean | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // the form starts from the session being edited, or sensible defaults
    const nameValue =
        name ??
        current?.name ??
        (profile?.username ? `${profile.username}'s session` : "My session");
    const joiningValue =
        joining ??
        (current
            ? current.allow_join_without_code
                ? "friends"
                : "code"
            : "friends");
    const roleValue = role ?? current?.default_role ?? "suggester";
    const approveValue = approve ?? current?.approve_joins ?? true;

    async function submit() {
        setError(null);
        const trimmed = nameValue.trim();
        if (!trimmed) {
            setError("Give it a name.");
            return;
        }
        const settings = {
            name: trimmed,
            default_role: roleValue,
            allow_join_without_code: joiningValue === "friends",
            approve_joins: approveValue,
        };
        setBusy(true);
        try {
            if (target) {
                await writes.updateSession(
                    quiet && !current
                        ? { ...settings, listen_along: false }
                        : settings,
                );
            } else {
                const { session_id } = await startLiveSession(settings);
                await seedSession(session_id);
            }
            if (!current && openPlayer) router.replace("/player");
            else router.back();
        } catch {
            setError(
                current
                    ? "Couldn't save the settings."
                    : "Couldn't start the session.",
            );
        } finally {
            setBusy(false);
        }
    }

    const buttonLabel = current
        ? busy
            ? "Saving..."
            : "Save"
        : busy
          ? "Starting..."
          : "Go live";

    return (
        <DetailScreen
            presentation="sheet"
            title={current ? "Session settings" : "Go live"}
        >
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-6 px-5 pb-10 pt-2"
                keyboardShouldPersistTaps="handled"
            >
                {!current ? (
                    <Text className="text-base leading-6 text-foreground">
                        Turn what you're playing into a live session, so friends
                        can listen and add songs with you.
                    </Text>
                ) : null}
                <Section title="Name">
                    <GlassInput
                        value={nameValue}
                        onChangeText={setName}
                        maxLength={60}
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

                {joiningValue === "friends" ? (
                    <Section title="When someone joins">
                        <View className="flex-row items-center gap-3">
                            <Text className="flex-1 text-base text-foreground">
                                Ask me first
                            </Text>
                            <GlassToggle
                                value={approveValue}
                                onValueChange={setApprove}
                                accessibilityLabel="Ask me before letting people in"
                            />
                        </View>
                        <Text className="text-sm leading-5 text-muted-foreground">
                            {approveValue
                                ? "You get a notification to let each person in. People with a code join right away."
                                : "Anyone your privacy settings allow joins right away."}
                        </Text>
                    </Section>
                ) : null}

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

                {!current ? (
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

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View className="gap-2">
            <Text className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {title}
            </Text>
            {children}
        </View>
    );
}
