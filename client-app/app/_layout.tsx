import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { initDb } from "@/lib/localdb";
import AccountProvider from "@/lib/account";

export default function RootLayout() {
    return (
        <SQLiteProvider databaseName="cadenzaLocalDb" onInit={initDb}>
            <AccountProvider>
                <Stack>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                </Stack>
            </AccountProvider>
        </SQLiteProvider>
    );
}
