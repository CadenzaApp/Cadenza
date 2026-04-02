import { useAccount } from "@/lib/account";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";

type AuthPageParams = { initialMode: "signup" | "signin" };

export default function AuthPage() {
    const { initialMode } = useLocalSearchParams<AuthPageParams>();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<any>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const { account, signIn, signUp } = useAccount();

    const [mode, setMode] = useState(initialMode);
    function toggleMode() {
        setMode((prevMode) => (prevMode == "signin" ? "signup" : "signin"));
    }

    async function onSubmit() {
        setLoading(true);

        try {
            if (mode === "signin") {
                await signIn(email, password);
            } else {
                await signUp(email, password);
            }
        } catch (error) {
            setError(error);
            setLoading(false);
        }
    }

    // already logged in
    if (account != null) {
        return <Redirect href="/" />;
    }

    return (
        <View style={{ flex: 1 }}>
            {loading && <Text>loading...</Text>}

            <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text> {mode == "signin" ? "sign in" : "sign up"} </Text>
                <Button title="toggle" onPress={toggleMode} />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text> email </Text>
                <TextInput
                    style={{
                        flex: 1,
                        padding: 4,
                        borderColor: "purple",
                        borderWidth: 1,
                    }}
                    value={email}
                    onChangeText={setEmail}
                />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text> password </Text>
                <TextInput
                    style={{
                        flex: 1,
                        padding: 4,
                        borderColor: "purple",
                        borderWidth: 1,
                    }}
                    value={password}
                    onChangeText={setPassword}
                />
            </View>

            {error != null && (
                <Text style={{ color: "red" }}>
                    {JSON.stringify(error, null, 4)}
                </Text>
            )}

            <Button onPress={onSubmit} title="submit" />
        </View>
    );
}
