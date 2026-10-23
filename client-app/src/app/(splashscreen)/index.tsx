/**
 * Display the splash screen while doing app
 * initialization, most notably retrieving the user's
 * existing session!!
 */

import { useAccount } from "@/lib/account";
import { useUserSettings } from "@/lib/routes/settings";
import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";

export default function SplashScreen() {
    const router = useRouter();
    const { tryRestoreSession } = useAccount();
    const { settingsReady } = useUserSettings();
    const [next, setNext] = useState<Href | null>(null);

    // retrieve existing user session.
    useEffect(() => {
        tryRestoreSession()
            .then((success) => {
                setNext(success ? "/library" : "/auth?initialMode=signin");
            })
            .catch((err) => {
                console.error("error restoring session: ", err);
                setNext("/auth?initialMode=signin");
            });
    }, [tryRestoreSession]);

    // the first screen opens in the user's own theme, not the defaults
    useEffect(() => {
        if (next && settingsReady) router.replace(next);
    }, [next, router, settingsReady]);

    return <Text> cadenza splash screen!! </Text>;
}
