import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "expo-router";
import { useIsFocused, useTheme } from "expo-router/react-navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    TextInput,
    View,
    type ListRenderItem,
} from "react-native";
import Animated from "react-native-reanimated";

import { GlassButton } from "@/components/ui/glass-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { classifyError } from "@/lib/app-error";
import { useUpdateProfile } from "@/lib/routes/profile";
import { useUserPosts } from "@/lib/routes/social";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";

import { initialsFromUsername } from "./format";
import { PostCard } from "./PostCard";
import type { SocialPost } from "./types";

/** Matches `MAX_USERNAME_CHARS` in backend-api/src/db/profile.rs. */
const MAX_USERNAME_CHARS = 64;
/** Matches `MAX_BIO_CHARS` in backend-api/src/db/profile.rs. */
const MAX_BIO_CHARS = 500;

type Props = {
    userId: string;
};

type SavedProfile = {
    username: string;
    bio: string;
};

/**
 * One user's public profile: avatar, username, bio, then their posts newest
 * first. Opened by tapping an author on the feed, the feed's "Me"
 * button, Account settings, or from Discuss, which closes itself and lands
 * here on the Social tab. On your own page, Edit replaces the username and
 * bio with the profile form.
 */
export function UserProfileScreen({ userId }: Props) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<SocialPost>>();
    const navigation = useNavigation();
    const focused = useIsFocused();
    const { account } = useAccount();
    const { profile, posts, userPostsLoading, userPostsErr } =
        useUserPosts(userId);
    const [saved, setSaved] = useState<SavedProfile | null>(null);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        setSaved(null);
        setEditing(false);
    }, [userId]);

    useEffect(() => {
        if (!focused) setEditing(false);
    }, [focused]);

    useEffect(() => {
        if (!saved || !profile) return;
        if (profile.username === saved.username && profile.bio === saved.bio) {
            setSaved(null);
        }
    }, [profile, saved]);

    const username = saved?.username ?? profile?.username;
    const bio = saved?.bio ?? profile?.bio;

    useLayoutEffect(() => {
        navigation.setOptions({
            title: username ?? "Profile",
        });
    }, [navigation, username]);

    const renderItem = useCallback<ListRenderItem<SocialPost>>(
        ({ item }) => <PostCard post={item} />,
        [],
    );

    const loading = userPostsLoading && posts.length === 0;
    const emptyLabel = loading
        ? "Loading posts..."
        : userPostsErr
          ? "Couldn't load posts."
          : "No posts yet.";

    return (
        <View className="flex-1 bg-background">
            <ScreenScrollMarker>
                <Animated.FlatList
                    {...scroll}
                    className="flex-1"
                    data={posts}
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={(post) => String(post.post_id)}
                    ListHeaderComponent={
                        <ProfileHeader
                            userId={userId}
                            username={username}
                            bio={bio}
                            loading={userPostsLoading && !profile && !saved}
                            canEdit={account?.id === userId && profile != null}
                            editing={editing}
                            onEdit={() => setEditing(true)}
                            onCancel={() => setEditing(false)}
                            onSaved={setSaved}
                        />
                    }
                    renderItem={renderItem}
                    ItemSeparatorComponent={PostSeparator}
                    contentContainerStyle={[
                        {
                            paddingTop: 8,
                            paddingHorizontal: 20,
                            paddingBottom: listBottomInset + 48,
                        },
                        scroll.contentContainerStyle,
                    ]}
                    ListEmptyComponent={
                        <Text className="py-10 text-center text-muted-foreground">
                            {emptyLabel}
                        </Text>
                    }
                    showsVerticalScrollIndicator={false}
                />
            </ScreenScrollMarker>
        </View>
    );
}

function ProfileHeader({
    userId,
    username,
    bio,
    loading,
    canEdit,
    editing,
    onEdit,
    onCancel,
    onSaved,
}: {
    userId: string;
    username?: string;
    bio?: string;
    loading: boolean;
    canEdit: boolean;
    editing: boolean;
    onEdit: () => void;
    onCancel: () => void;
    onSaved: (profile: SavedProfile) => void;
}) {
    if (loading) {
        return (
            <View className="mb-4 gap-3 py-2">
                <Text className="text-muted-foreground">
                    Loading profile...
                </Text>
            </View>
        );
    }

    if (editing && canEdit) {
        return (
            <ProfileEditor
                userId={userId}
                initialUsername={username ?? ""}
                initialBio={bio ?? ""}
                onCancel={onCancel}
                onSaved={(profile) => {
                    onSaved(profile);
                    onCancel();
                }}
            />
        );
    }

    const name = username ?? "unknown";
    const trimmedBio = bio?.trim() ?? "";

    return (
        <View className="mb-4 gap-3 border-b border-border pb-5 pt-2">
            <View className="flex-row items-center gap-3">
                <View className="h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <Text className="text-base font-semibold text-foreground">
                        {initialsFromUsername(name)}
                    </Text>
                </View>
                <Text
                    className="min-w-0 flex-1 text-xl font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {name}
                </Text>
                {canEdit ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Edit profile"
                        hitSlop={8}
                        onPress={onEdit}
                        className="active:opacity-60"
                    >
                        <Text className="text-sm font-semibold text-primary">
                            Edit
                        </Text>
                    </Pressable>
                ) : null}
            </View>
            {trimmedBio ? (
                <Text className="text-base leading-6 text-foreground">
                    {trimmedBio}
                </Text>
            ) : (
                <Text className="text-sm text-muted-foreground">
                    No bio yet.
                </Text>
            )}
        </View>
    );
}

function ProfileEditor({
    userId,
    initialUsername,
    initialBio,
    onCancel,
    onSaved,
}: {
    userId: string;
    initialUsername: string;
    initialBio: string;
    onCancel: () => void;
    onSaved: (profile: SavedProfile) => void;
}) {
    const { colors } = useTheme();
    const { updateProfile, updateProfileLoading, resetUpdateProfile } =
        useUpdateProfile([{ path: `/social/posts/user/${userId}` }]);
    const [username, setUsername] = useState(initialUsername);
    const [bio, setBio] = useState(initialBio);
    const [saveError, setSaveError] = useState<string | null>(null);

    const trimmedUsername = username.trim();
    const trimmedBio = bio.trim();
    const dirty =
        trimmedUsername !== initialUsername || trimmedBio !== initialBio;
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
            const updated = await updateProfile({
                username: trimmedUsername,
                bio: trimmedBio,
            });
            onSaved({ username: updated.username, bio: updated.bio });
        } catch (error) {
            console.error("Profile save error:", error);
            setSaveError(profileSaveErrorMessage(error));
        }
    }

    return (
        <View className="mb-4 gap-4 border-b border-border pb-5 pt-2">
            <View className="flex-row items-center justify-end">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel editing profile"
                    hitSlop={8}
                    disabled={updateProfileLoading}
                    onPress={onCancel}
                    className="active:opacity-60"
                >
                    <Text className="text-sm font-semibold text-primary">
                        Cancel
                    </Text>
                </Pressable>
            </View>

            <View className="gap-1.5">
                <Label>Username</Label>
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
                />
                <Text className="text-right text-xs text-muted-foreground">
                    {username.trim().length}/{MAX_USERNAME_CHARS}
                </Text>
            </View>

            <View className="gap-1.5">
                <Label>Bio</Label>
                <View className="overflow-hidden rounded-md border border-border">
                    <TextInput
                        value={bio}
                        onChangeText={(text) => {
                            setBio(text.slice(0, MAX_BIO_CHARS));
                            setSaveError(null);
                        }}
                        placeholder="Say something about yourself"
                        placeholderTextColor="#888888"
                        multiline
                        maxLength={MAX_BIO_CHARS}
                        editable={!updateProfileLoading}
                        textAlignVertical="top"
                        className="min-h-[96px] bg-input px-3 py-3 text-base text-foreground"
                    />
                </View>
                <Text className="text-right text-xs text-muted-foreground">
                    {bio.trim().length}/{MAX_BIO_CHARS}
                </Text>
            </View>

            {saveError ? (
                <Text className="text-sm text-destructive">{saveError}</Text>
            ) : null}

            <GlassButton
                className="w-full"
                disabled={!canSave}
                onPress={() => void handleSave()}
            >
                {updateProfileLoading ? (
                    <ActivityIndicator size="small" color={colors.text} />
                ) : (
                    <Ionicons
                        name="checkmark-outline"
                        size={19}
                        color={colors.text}
                    />
                )}
                <Text>
                    {updateProfileLoading ? "Saving..." : "Save changes"}
                </Text>
            </GlassButton>
        </View>
    );
}

function PostSeparator() {
    return <View className="h-3" />;
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
