import { NAV_THEME } from "@/lib/theme";
import { ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { initDb } from "@/lib/localdb";
import AccountProvider from "@/lib/account";
import { PortalHost } from "@rn-primitives/portal";
import { useColorScheme } from "nativewind";

import "../../global.css";

export default function RootLayout() {
  const { colorScheme } = useColorScheme();

  return (
    <SQLiteProvider databaseName="cadenzaLocalDb" onInit={initDb}>
      <AccountProvider>
        <ThemeProvider
          value={colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light}
        >
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="auth/index" options={{ title: "Welcome" }} />
          </Stack>
        </ThemeProvider>
        <PortalHost />
      </AccountProvider>
    </SQLiteProvider>
  );
}
