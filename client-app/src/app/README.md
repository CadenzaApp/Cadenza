# app

expo-router routes. The file tree is the navigation tree. Screens here should stay thin: wire
up hooks from `@/lib`, render components from `@/components` and `@/features`, and keep real
logic out.

## Files

| file | route | role |
| --- | --- | --- |
| `_layout.tsx` | root | Provider stack, theme, the `Stack` navigator, `PortalHost`, `MediaPlayerHost`. |
| `(splashscreen)/index.tsx` | `/` | Calls `tryRestoreSession()`, then replaces to `/home` or `/auth`. |
| `auth/index.tsx` | `/auth` | Sign in / sign up. Takes an `initialMode` search param. |
| `(tabs)/_layout.tsx` | | Bottom tab bar, five tabs, Ionicons, colors from the nav theme. |
| `(tabs)/home.tsx` | `/home` | Placeholder. Shows the email and a sign out button. |
| `(tabs)/tags.tsx` | `/tags` | The user's tags as pills, with the create-tag dialog. |
| `(tabs)/query.tsx` | `/query` | Hosts the query builder, then swaps to results. |
| `(tabs)/explore.tsx` | `/explore` | Apple Music catalog search and library browsing. |
| `(tabs)/account.tsx` | `/account` | Connect and disconnect Apple Music. |
| `tag/[tagId].tsx` | `/tag/:tagId` | One tag and the songs carrying it. |
| `+not-found.tsx` | | 404. |

`(splashscreen)` and `(tabs)` are route groups, so the parentheses do not appear in the url.

## How it works

`_layout.tsx` nests providers, and **the order matters**:

```
GestureHandlerRootView
  AccountProvider          supabase session -> the jwt everything else needs
    AppleMusicProvider     apple music auth, restored from secure store
      PlaybackProvider     reads the native playback snapshot
        ThemeProvider      light/dark nav theme from nativewind's colorScheme
          Stack            the routes
          PortalHost       where dialogs and modals render
          MediaPlayerHost  the global player
```

`PortalHost` and `MediaPlayerHost` sit as siblings of `Stack`, not inside it, so both survive
navigation. `MediaPlayerHost` reads `useSegments()` and decides whether to render the player and
what bottom offset to use: `54` under the tab bar, `0` on the `tag/` stack route, nothing
anywhere else. Playback state itself is global regardless, since it lives in `PlaybackProvider`.

Auth gating is per screen, not centralized. Each protected screen does:

```tsx
const { account } = useAccount();
if (!account) return <Redirect href="/auth?initialMode=signin" />;
```

The splash screen owns session restore, which is why `AccountProvider` has no loading state.
Every other screen can assume the account is either there or not.

## Connects to

- `@/lib/account`, `@/lib/apple-music-auth`, `@/lib/playback` for the providers.
- `@/lib/routes/*` and `@/lib/musickit-hooks` for data.
- `@/features/query-builder` from the query tab.
- `@/components/custom` and `@/components/ui` for everything rendered.

## Gotchas

- Adding a protected screen means adding the `Redirect` guard yourself. Nothing does it for you.
- A new top-level route also needs a `Stack.Screen` entry in `_layout.tsx` if you want anything
  other than the default header, and a `MediaPlayerHost` case if the player should show there.
- `home.tsx` is still a placeholder with a sign out button on it.
- Tab order in the bar is set by the order of `Tabs.Screen` children, not by filename.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
