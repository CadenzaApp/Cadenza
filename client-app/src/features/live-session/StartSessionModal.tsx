import { useRouter, type Href } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
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

/** Keeps a long form inside the popup on a small phone. */
const FORM_MAX_HEIGHT = 520;

/**
 * Starts a live session, or with `editing` changes the caller's session
 * settings. Music plays on the host's phone, and their current queue becomes
 * the session's. A quiet listen along session the caller hosts is turned into
 * a regular one instead of starting another, so its listeners stay.
 */
export function StartSessionModal({
    editing = false,
    title,
    onClose,
    onStarted,
}: {
    /** Edit the caller's session rather than start one. */
    editing?: boolean;
    title?: string;
    onClose: () => void;
    onStarted?: () => void;
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
            onClose();
            if (!current) onStarted?.();
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
        <ModalPopup
            visible
            keyboardAware
            onClose={onClose}
            title={
                title ?? (current ? "Session settings" : "Start a live session")
            }
        >
            <ScrollView
                style={{ maxHeight: FORM_MAX_HEIGHT }}
                contentContainerClassName="gap-5 px-1 pb-1"
                keyboardShouldPersistTaps="handled"
            >
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
                            onPress={() => {
                                onClose();
                                router.push("/privacy" as Href);
                            }}
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
        </ModalPopup>
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
