import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { initDb } from "@/lib/localdb";

export default function RootLayout() {
    return (
        <SQLiteProvider databaseName="cadenzaLocalDb" onInit={initDb}>
            <Stack>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
        </SQLiteProvider>
    );
}
