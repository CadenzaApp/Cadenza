import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";

import { useAccount } from "./account";
import { logHandledError } from "./log";

/**
 * The Android channel push notifications land in. A sender that names no
 * channel lands in the system's "Miscellaneous" one instead, which does not
 * pop up, so FCM messages should set `android.notification.channel_id` to
 * this.
 */
export const DEFAULT_NOTIFICATION_CHANNEL = "default";

/**
 * Shows a push notification that arrives while the app is open as a system
 * banner, the same as one that arrives while it is closed. Without a handler,
 * expo-notifications drops notifications in the foreground. Closed or in the
 * background, the OS shows FCM notification messages by itself.
 */
const SHOW_IN_FOREGROUND: Notifications.NotificationHandler = {
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
};

/**
 * Sets up push notifications. Renders nothing. Mounted at the root under
 * `AccountProvider`.
 *
 * The foreground handler is on for as long as it is mounted. Once someone is
 * signed in, it makes the Android channel and asks for permission, so a fresh
 * install is not prompted before login. Android 13 and up only shows the
 * prompt once a channel exists, which is why the channel comes first.
 *
 * The device token is not sent to the backend yet, since nothing there sends
 * pushes. In a dev build it is logged, to paste into the Firebase console's
 * test message.
 */
export function PushNotifications() {
    const { account } = useAccount();
    const accountId = account?.id;

    useEffect(() => {
        if (Platform.OS === "web") return;
        Notifications.setNotificationHandler(SHOW_IN_FOREGROUND);
        return () => Notifications.setNotificationHandler(null);
    }, []);

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
                if (!granted || !live || !__DEV__) return;
                const token = await Notifications.getDevicePushTokenAsync();
                console.log(
                    `[push] ${token.type} device token:`,
                    String(token.data),
                );
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
