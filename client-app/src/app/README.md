# app

expo-router routes. The file tree is the navigation tree. Screens here should stay thin: wire
up hooks from `@/lib`, render components from `@/components` and `@/features`, and keep real
logic out.

## Files

| file | route | role |
| --- | --- | --- |
| `_layout.tsx` | root | Provider stack, theme, the `Stack` navigator, `PortalHost`, `MediaPlayerHost`. |
| `(splashscreen)/index.tsx` | `/` | Calls `tryRestoreSession()`, then replaces to `/library` or `/auth`. |
| `auth/index.tsx` | `/auth` | Sign in / sign up. Takes an `initialMode` search param. |
| `(tabs)/_layout.tsx` | | Protected tab group, shared top rail, and the five-tab bottom bar. |
| `(tabs)/social.tsx` | `/social` | Static previews of planned social features. |
| `(tabs)/analytics.tsx` | `/analytics` | Static previews of planned listening analytics. |
| `(tabs)/cadenza.tsx` | `/cadenza` | Combined Query and Tags workspace. |
| `(tabs)/library.tsx` | `/library` | The user's Apple Music library, with paging and sorting. |
| `(tabs)/search.tsx` | `/search` | Apple Music catalog search and paged results. |
| `account.tsx` | `/account` | Draggable account sheet with Apple Music and session controls. |
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

Auth gating for the five primary screens is centralized in `(tabs)/_layout.tsx`:

```tsx
const { account } = useAccount();
if (!account) return <Redirect href="/auth?initialMode=signin" />;
```

The account modal has its own guard because it is a root stack route. The splash screen owns
session restore, which is why `AccountProvider` has no loading state. Successful restore and
authentication both land on `/library`.

Every tab uses `TopRail` as its navigator header. The page title sits on the left, the account
initials button sits on the right, and the button opens `/account`. The root stack presents that
route as a rounded `formSheet` with a visible grabber. It can be closed with the X or dragged
down, and dismissing it returns to the same tab.

## Connects to

- `@/lib/account`, `@/lib/apple-music-auth`, `@/lib/playback` for the providers.
- `@/lib/routes/*` and `@/lib/musickit-hooks` for data.
- `@/features/cadenza` from the Cadenza tab.
- `@/components/custom` and `@/components/ui` for everything rendered.

## Gotchas

- Routes inside `(tabs)` inherit the group's auth guard. Protected root stack routes still need
  their own guard.
- A new top-level route also needs a `Stack.Screen` entry in `_layout.tsx` if you want anything
  other than the default header, and a `MediaPlayerHost` case if the player should show there.
- Tab order in the bar is set by the order of `Tabs.Screen` children, not by filename.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
