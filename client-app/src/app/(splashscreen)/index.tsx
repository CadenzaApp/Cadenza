/**
 * Display the splash screen while doing app
 * initialization, most notably retrieving the user's
 * existing session!!
 */

import { useAccount } from "@/lib/account";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Text } from "react-native";

export default function SplashScreen() {
    const router = useRouter();
    const { tryRestoreSession } = useAccount();

    // retrieve existing user session.
    useEffect(() => {
        console.log("loaded splash screen");

        tryRestoreSession()
            .then((success) => {
                router.replace(success ? "/home" : "/auth?initialMode=signin");
            })
            .catch((err) => {
                console.error("error restoring session: ", err);
                router.replace("/auth?initialMode=signin");
            });
    }, []);

    return <Text> cadenza splash screen!! </Text>;
}
