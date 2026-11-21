import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";

import { useToast, type ToastIcon } from "@/components/custom/toast";

import { useAccount } from "./account";
import { logHandledError } from "./log";
import { registerPushToken } from "./push-token";

/**
 * The Android channel push notifications land in. A sender that names no
 * channel lands in the system's "Miscellaneous" one instead, which does not
 * pop up, so FCM messages should set `android.notification.channel_id` to
 * this.
 */
export const DEFAULT_NOTIFICATION_CHANNEL = "default";

/**
 * A push that arrives while the app is open draws no system banner, sound, or
 * list entry. {@link PushNotifications} shows it as a toast instead. Closed or
 * in the background, the OS shows it by itself and this is not asked.
 */
const HIDE_IN_FOREGROUND: Notifications.NotificationHandler = {
    handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
    }),
};

/**
 * Sets up push notifications. Renders nothing. Mounted at the root under
 * `AccountProvider` and `ToastProvider`.
 *
 * While it is mounted, a push that arrives with the app open becomes a toast
 * with the push's title and body, not a system notification. Once someone is
 * signed in, it makes the Android channel and asks for permission, so a fresh
 * install is not prompted before login. Android 13 and up only shows the
 * prompt once a channel exists, which is why the channel comes first.
 *
 * Pushes go through Expo's push service, which takes an Expo push token
 * (`ExponentPushToken[...]`) and delivers through FCM and APNs. Getting one
 * needs the EAS project id in `extra.eas.projectId` (`eas init`). On Android
 * it also needs Firebase in the native project, so a build from before
 * `googleServicesFile` was set fails here. With permission, the token is
 * registered with the backend on every sign in and app start (`POST
 * /push-tokens`), and sign out removes it (see `push-token.ts`). In a dev
 * build it is also logged, to paste into Expo's push notification tool.
 */
export function PushNotifications() {
    const { account } = useAccount();
    const accountId = account?.id;
    const { showToast } = useToast();

    useEffect(() => {
        if (Platform.OS === "web") return;
        Notifications.setNotificationHandler(HIDE_IN_FOREGROUND);
        const received = Notifications.addNotificationReceivedListener(
            (notification) => {
                const { title, body, data } = notification.request.content;
                // a like on a post with no text has an empty body
                const message = body || title;
                if (!message) return;
                showToast(
                    message,
                    body ? (title ?? undefined) : undefined,
                    pushIcon(data?.type),
                );
            },
        );
        return () => {
            received.remove();
            Notifications.setNotificationHandler(null);
        };
    }, [showToast]);

    useEffect(() => {
        if (!accountId || Platform.OS === "web") return;
        let live = true;
        void (async () => {
            try {
                if (Platform.OS === "android") {
                    await Notifications.setNotificationChannelAsync(
                        DEFAULT_NOTIFICATION_CHANNEL,
                        {
                            name: "Notifications",
                            importance: AndroidImportance.HIGH,
                        },
                    );
                }
                const current = await Notifications.getPermissionsAsync();
                const granted = current.granted
                    ? true
                    : (await Notifications.requestPermissionsAsync()).granted;
                if (!granted || !live) return;
                const projectId = easProjectId();
                if (!projectId) {
                    console.warn(
                        "[push] No EAS project id, so no Expo push token. Run `eas init` and set extra.eas.projectId in app.config.js.",
                    );
                    return;
                }
                const token = await Notifications.getExpoPushTokenAsync({
                    projectId,
                });
                // signed out or switched account while the token was coming
                if (!live) return;
                if (__DEV__) console.log("[push] Expo push token:", token.data);
                await registerPushToken(token.data);
            } catch (error) {
                logHandledError("Setting up push notifications failed", error);
            }
        })();
        return () => {
            live = false;
        };
    }, [accountId]);

    return null;
}

/**
 * The toast icon for a push, by the `type` the backend put in its data. See
 * `backend-api/src/services/push_triggers.rs`.
 */
function pushIcon(type: unknown): ToastIcon {
    switch (type) {
        case "comment":
            return "chatbubble";
        case "post_like":
            return "heart";
        case "friend_post":
            return "create";
        case "live_session":
            return "radio";
        default:
            return "notifications";
    }
}

/** The EAS project id the Expo push token is issued for, or undefined. */
function easProjectId(): string | undefined {
    const fromConfig = (
        Constants.expoConfig?.extra as
            | { eas?: { projectId?: string } }
            | undefined
    )?.eas?.projectId;
    return fromConfig ?? Constants.easConfig?.projectId ?? undefined;
}
