import { Redirect } from "expo-router";
import { useRef, useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    View,
    type TextInput,
} from "react-native";

import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { logHandledError } from "@/lib/log";

import { authErrorMessage } from "./auth-error-message";
import {
    CADENZA_NEBULA,
    OnboardingBackdrop,
    Wordmark,
} from "./onboarding-backdrop";
import { ONBOARDING_HREF } from "./onboarding-step";
import { useOnboarding } from "./use-onboarding";

export type LoginMode = "signin" | "signup";

const MODES = [
    { value: "signin", label: "Sign in", icon: "log-in-outline" },
    { value: "signup", label: "Sign up", icon: "person-add-outline" },
] as const;

/** Step one of onboarding: a Cadenza account, by email and password. */
export function LoginScreen({ initialMode }: { initialMode?: LoginMode }) {
    const { signIn, signUp } = useAccount();
    const { step } = useOnboarding();
    const [mode, setMode] = useState<LoginMode>(initialMode ?? "signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const passwordRef = useRef<TextInput>(null);

    if (step !== "login" && step !== "pending") {
        return <Redirect href={ONBOARDING_HREF[step]} />;
    }

    // signed in and still loading what comes next counts as busy too
    const busy = submitting || step === "pending";

    function changeMode(next: LoginMode) {
        setMode(next);
        setError(null);
        setNotice(null);
    }

    async function submit() {
        if (busy) return;
        setSubmitting(true);
        setError(null);
        setNotice(null);
        try {
            const trimmed = email.trim();
            if (mode === "signin") {
                await signIn(trimmed, password);
            } else {
                const { needsEmailConfirmation } = await signUp(
                    trimmed,
                    password,
                );
                if (needsEmailConfirmation) {
                    setMode("signin");
                    setNotice(
                        "Check your email for a confirmation link, then sign in.",
                    );
                }
            }
        } catch (err) {
            logHandledError("Sign in failed", err);
            setError(authErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <OnboardingBackdrop colors={CADENZA_NEBULA}>
            <KeyboardAvoidingView
                className="flex-1"
                behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
                <ScrollView
                    contentContainerClassName="flex-grow justify-center gap-10 px-6 py-8"
                    keyboardShouldPersistTaps="handled"
                >
                    <Wordmark tagline="Tag your music. Query it back out." />

                    <View className="gap-4">
                        <SegmentedControl
                            options={MODES}
                            value={mode}
                            onChange={changeMode}
                        />
                        <GlassInput
                            icon="mail-outline"
                            placeholder="Email"
                            keyboardType="email-address"
                            autoComplete="email"
                            textContentType="emailAddress"
                            autoCapitalize="none"
                            autoCorrect={false}
                            value={email}
                            onChangeText={setEmail}
                            returnKeyType="next"
                            submitBehavior="submit"
                            onSubmitEditing={() => passwordRef.current?.focus()}
                            editable={!busy}
                        />
                        <GlassInput
                            ref={passwordRef}
                            icon="lock-closed-outline"
                            placeholder="Password"
                            secureTextEntry
                            autoComplete={
                                mode === "signup" ? "new-password" : "password"
                            }
                            textContentType={
                                mode === "signup" ? "newPassword" : "password"
                            }
                            value={password}
                            onChangeText={setPassword}
                            returnKeyType="go"
                            onSubmitEditing={() => void submit()}
                            editable={!busy}
                        />

                        {error ? (
                            <Text
                                accessibilityRole="alert"
                                className="px-1 text-sm leading-5 text-destructive"
                            >
                                {error}
                            </Text>
                        ) : null}
                        {notice ? (
                            <Text className="px-1 text-sm leading-5 text-muted-foreground">
                                {notice}
                            </Text>
                        ) : null}

                        <GlassButton
                            onPress={() => void submit()}
                            disabled={busy}
                            accessibilityLabel={
                                mode === "signin" ? "Sign in" : "Create account"
                            }
                        >
                            {busy ? (
                                <ActivityIndicator />
                            ) : (
                                <Text className="text-base font-semibold">
                                    {mode === "signin"
                                        ? "Sign in"
                                        : "Create account"}
                                </Text>
                            )}
                        </GlassButton>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </OnboardingBackdrop>
    );
}
