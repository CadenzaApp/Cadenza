import { useAccount } from "@/lib/account";
import { Redirect } from "expo-router";
import { View, Text, StyleSheet, Button } from "react-native";

export default function HomeScreen() {
    const { account, signOut } = useAccount();

    if (!account) return <Redirect href="/auth?initialMode=signin" />;

    return (
        <View style={styles.container}>
            <Text>Hello, {account.email}</Text>
            <Button title="sign out" onPress={signOut} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#25292e",
        alignItems: "center",
        justifyContent: "center",
        
    },
    text: {
        color: "#fff",
    },
    button: {
        fontSize: 20,
        textDecorationLine: "underline",
        color: "#fff",
    },
});
