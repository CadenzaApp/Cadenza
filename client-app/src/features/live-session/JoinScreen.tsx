import { useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { Text } from "@/components/ui/text";
import {
    cleanInviteCode,
    INVITE_CODE_LENGTH,
    useRedeemInvite,
} from "@/lib/routes/invites";

/** One line for each way a redeem can fail. */
function failureMessage(error: unknown): string {
    const type = (error as { error_type?: string } | null)?.error_type;
    switch (type) {
        case "InviteCodeInvalid":
            return "That code is not valid any more.";
        case "TooManyRequests":
            return "Too many tries. Wait a minute.";
        case "Forbidden":
            return "You can't join this session.";
        case "SessionEnded":
            return "That session has ended.";
        default:
            return "Couldn't reach Cadenza. Try again.";
    }
}

/**
 * Enter an invite code for a live session or a shared playlist. With
 * `initialCode`, from a `cadenza://join/CODE` link, it redeems straight away.
 * A session opens in its sheet; a playlist opens on the Social tab.
 */
export function JoinScreen({ initialCode }: { initialCode?: string }) {
    const router = useRouter();
    const { redeemInvite, redeemInviteLoading } = useRedeemInvite();
    const [code, setCode] = useState(() => cleanInviteCode(initialCode ?? ""));
    const [error, setError] = useState<string | null>(null);
    const autoTried = useRef(false);

    const complete = code.length === INVITE_CODE_LENGTH;

    /** Where a redeemed code goes: a session's sheet, or the playlist. */
    function open(target: { kind: string; id: string }) {
        if (target.kind === "live_session") {
            router.replace("/player");
        } else {
            router.back();
            router.push(`/social/playlist/${target.id}` as Href);
        }
    }

    async function join(value = code) {
        if (value.length !== INVITE_CODE_LENGTH || redeemInviteLoading) return;
        try {
            open(await redeemInvite({ code: value }));
        } catch (failure) {
            setError(failureMessage(failure));
        }
    }

    // a deep link redeems on open, once
    useEffect(() => {
        if (autoTried.current || !initialCode) return;
        autoTried.current = true;
        const cleaned = cleanInviteCode(initialCode);
        if (cleaned.length !== INVITE_CODE_LENGTH) return;
        void (async () => {
            try {
                open(await redeemInvite({ code: cleaned }));
            } catch (failure) {
                setError(failureMessage(failure));
            }
        })();
        // runs once for the link it opened with
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <DetailScreen presentation="sheet" title="Join with a code">
            <View className="gap-4 px-5 pt-2">
                <Text className="text-sm leading-5 text-muted-foreground">
                    Enter the 8 character code a friend sent you for a live
                    session or a playlist.
                </Text>
                <GlassInput
                    accessibilityLabel="Invite code"
                    accessibilityHint="8 letters and numbers"
                    value={
                        code.length > 4
                            ? `${code.slice(0, 4)}-${code.slice(4)}`
                            : code
                    }
                    onChangeText={(text) => {
                        setError(null);
                        setCode(cleanInviteCode(text));
                    }}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoFocus={!initialCode}
                    textContentType="oneTimeCode"
                    returnKeyType="go"
                    onSubmitEditing={() => {
                        setError(null);
                        void join();
                    }}
                    className="text-center text-2xl tracking-[6px]"
                    style={{
                        fontFamily:
                            Platform.OS === "ios" ? "Menlo" : "monospace",
                    }}
                />
                {error ? (
                    <Text
                        accessibilityRole="alert"
                        className="text-sm text-destructive"
                    >
                        {error}
                    </Text>
                ) : null}
                <GlassButton
                    disabled={!complete || redeemInviteLoading}
                    onPress={() => {
                        setError(null);
                        void join();
                    }}
                >
                    <Text className="font-semibold text-foreground">
                        {redeemInviteLoading ? "Joining..." : "Join"}
                    </Text>
                </GlassButton>
            </View>
        </DetailScreen>
    );
}
