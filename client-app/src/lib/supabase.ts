import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://zerlyloonvyujsculwde.supabase.co";

const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_VlG0XaDpUVGlF03Z84A7-Q_yfn7DSvX";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// autoRefreshToken is a timer, and a timer in a backgrounded app is not
// reliable. Supabase asks react native clients to drive it off AppState so the
// refresh loop stops when the app leaves the foreground and runs again (with a
// catch-up refresh) when it comes back.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

/**
 * The current access token, refreshed first if it has expired. Returns `null`
 * when nobody is signed in.
 *
 * Call this per request instead of holding a token. An access token lives about
 * an hour, so anything that cached one at sign in starts sending an expired
 * token and gets a 401 back.
 */
export async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}
