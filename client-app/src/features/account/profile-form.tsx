import { useState } from "react";
import { TextInput, View } from "react-native";

import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { classifyError } from "@/lib/app-error";
import { useUpdateProfile, type Profile } from "@/lib/routes/profile";
import { useAppTheme } from "@/lib/theme";

/** Matches `MAX_USERNAME_CHARS` in backend-api/src/db/profile.rs. */
const MAX_USERNAME_CHARS = 64;
/** Matches `MAX_BIO_CHARS` in backend-api/src/db/profile.rs. */
const MAX_BIO_CHARS = 500;

/**
 * The one place a username and bio are edited. Starts from `profile`; mount it
 * with a key from the saved values so a save, or an edit from another device,
 * resets the fields.
 */
export function ProfileForm({ profile }: { profile: Profile }) {
    const { mutedForeground } = useAppTheme().colors;
    const { updateProfile, updateProfileLoading, resetUpdateProfile } =
        useUpdateProfile([{ path: `/social/posts/user/${profile.uid}` }]);
    const [username, setUsername] = useState(profile.username);
    const [bio, setBio] = useState(profile.bio);
    const [saveError, setSaveError] = useState<string | null>(null);

    const trimmedUsername = username.trim();
    const trimmedBio = bio.trim();
    const dirty =
        trimmedUsername !== profile.username || trimmedBio !== profile.bio;
    const usernameValid =
        trimmedUsername.length > 0 &&
        trimmedUsername.length <= MAX_USERNAME_CHARS &&
        !trimmedUsername.includes("@");
    const bioValid = trimmedBio.length <= MAX_BIO_CHARS;
    const canSave = dirty && usernameValid && bioValid && !updateProfileLoading;

    async function handleSave() {
        if (!canSave) return;

        setSaveError(null);
        resetUpdateProfile();
        try {
            await updateProfile({
                username: trimmedUsername,
                bio: trimmedBio,
            });
        } catch (error) {
            console.error("Profile save error:", error);
            setSaveError(profileSaveErrorMessage(error));
        }
    }

    function revert() {
        setUsername(profile.username);
        setBio(profile.bio);
        setSaveError(null);
    }

    return (
        <GlassPanel>
            <View className="gap-4 p-4">
                <View className="gap-1.5">
                    <View className="flex-row items-center justify-between">
                        <Label>Username</Label>
                        <Text className="text-xs text-muted-foreground">
                            {trimmedUsername.length}/{MAX_USERNAME_CHARS}
                        </Text>
                    </View>
                    <Input
                        value={username}
                        onChangeText={(text) => {
                            setUsername(text.slice(0, MAX_USERNAME_CHARS));
                            setSaveError(null);
                        }}
                        placeholder="username"
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={MAX_USERNAME_CHARS}
                        editable={!updateProfileLoading}
                        returnKeyType="next"
                        accessibilityLabel="Username"
                    />
                    {trimmedUsername.includes("@") ? (
                        <Text className="text-xs text-destructive">
                            A username cannot contain @.
                        </Text>
                    ) : null}
                </View>

                <View className="gap-1.5">
                    <View className="flex-row items-center justify-between">
                        <Label>Bio</Label>
                        <Text className="text-xs text-muted-foreground">
                            {trimmedBio.length}/{MAX_BIO_CHARS}
                        </Text>
                    </View>
                    <TextInput
                        value={bio}
                        onChangeText={(text) => {
                            setBio(text.slice(0, MAX_BIO_CHARS));
                            setSaveError(null);
                        }}
                        placeholder="Say something about yourself"
                        placeholderTextColor={mutedForeground}
                        multiline
                        maxLength={MAX_BIO_CHARS}
                        editable={!updateProfileLoading}
                        textAlignVertical="top"
                        accessibilityLabel="Bio"
                        className="min-h-[96px] rounded-md bg-input px-3 py-3 text-base text-foreground"
                    />
                </View>

                {saveError ? (
                    <Text className="text-sm text-destructive">
                        {saveError}
                    </Text>
                ) : null}

                {dirty ? (
                    <View className="flex-row justify-end gap-2">
                        <GlassPill
                            label="Discard"
                            disabled={updateProfileLoading}
                            onPress={revert}
                        />
                        <GlassPill
                            icon="checkmark-outline"
                            label={updateProfileLoading ? "Saving..." : "Save"}
                            loading={updateProfileLoading}
                            disabled={!canSave}
                            onPress={() => void handleSave()}
                        />
                    </View>
                ) : null}
            </View>
        </GlassPanel>
    );
}

/** User-facing sentence for a failed profile save. */
function profileSaveErrorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null) {
        const type = (error as { error_type?: unknown }).error_type;
        const message = (error as { message?: unknown }).message;

        if (type === "UsernameAlreadyTaken") {
            return "That username is already taken.";
        }
        if (
            (type === "QueryFormatError" || type === "InvalidRequestBody") &&
            typeof message === "string" &&
            message.length > 0
        ) {
            return sentenceCase(message);
        }
    }

    return classifyError(error).detail;
}

function sentenceCase(message: string): string {
    const trimmed = message.trim();
    if (!trimmed) return trimmed;
    const capped = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}
