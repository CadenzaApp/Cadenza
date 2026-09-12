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
| `(tabs)/_layout.tsx` | | Protected tab group, shared top rail, and the floating five-tab bar. |
| `(tabs)/social.tsx` | `/social` | Static previews of planned social features. |
| `(tabs)/analytics.tsx` | `/analytics` | Static previews of planned listening analytics. |
| `(tabs)/cadenza.tsx` | `/cadenza` | The boolean query workspace. |
| `(tabs)/library.tsx` | `/library` | Library index: a row per category, then Recently Added. |
| `(tabs)/search.tsx` | `/search` | Apple Music catalog search and paged results. |
| `account.tsx` | `/account` | Account sheet with Apple Music and session controls. |
| `player.tsx` | `/player` | Now playing sheet. Renders `MediaPlayerExpanded`. |
| `library-categories.tsx` | `/library-categories` | Sheet. Picks which rows the library shows. |
| `category/[kind].tsx` | `/category/:kind` | Sheet. One library category's contents. |
| `collection/[kind]/[id].tsx` | `/collection/:kind/:id` | Sheet. The songs in one album or playlist. |
| `tag/[tagId].tsx` | `/tag/:tagId` | Sheet. One tag and the songs carrying it. |
| `artist/[id].tsx` | `/artist/:id` | Sheet. One catalog artist: an albums rail, then top songs. |
| `add-to-playlist.tsx` | `/add-to-playlist` | Sheet. Picks a library playlist for a song, or makes one. |
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

`LibraryCategoriesProvider` (`@/features/library`) sits inside `ThemeProvider` and wraps both
`Stack` and the hosts, because the library screen reads the category selection and the
`/library-categories` sheet writes it, and those are separate routes.

`PortalHost` and `MediaPlayerHost` sit as siblings of `Stack`, not inside it, so both survive
navigation. `MediaPlayerHost` only decides whether the player renders; every offset comes from
`@/lib/screen-overlay`. Playback state itself is global regardless, since it lives in
`PlaybackProvider`.

Auth gating for the five primary screens is centralized in `(tabs)/_layout.tsx`:

```tsx
const { account } = useAccount();
if (!account) return <Redirect href="/auth?initialMode=signin" />;
```

The account modal has its own guard because it is a root stack route. The splash screen owns
session restore, which is why `AccountProvider` has no loading state. Successful restore and
authentication both land on `/library`.

## The floating bottom bars

The tab bar is `position: "absolute"`, a rounded pill inset from the edges, drawn on a
`GlassSurface`. The compact media player floats as a matching pill above it. Content scrolls
**behind** both and shows in the gutters beside them.

Because neither bar is in the layout, nothing reserves space for them. Every scrolling surface
has to pad itself with `contentBottomInset` or `listBottomInset` from
`@/lib/screen-overlay::useScreenOverlayInsets`. Miss it on a new screen and its last row hides
under the pill. `TAB_BAR_HEIGHT` and `TAB_BAR_MARGIN` are shared between that hook and the
`tabBarStyle` here, so they cannot drift.

Both pills are inset with `marginHorizontal: TAB_BAR_MARGIN`, not `left`/`right`.
`BottomTabBar`'s own style sets `start: 0, end: 0`, and in Yoga those beat `left`/`right`, so a
`left`/`right` inset in `tabBarStyle` is silently ignored and the bar spans the full width.

The selected tab gets a dark bubble behind its icon and label, the way Music marks its tab. It
comes from a custom `tabBarButton`, because the navigator's own `tabBarActiveBackgroundColor`
paints the whole item box square. The button only sees `aria-selected`, so that is what the
bubble keys off.

## The top rail

Every tab uses `TopRail` as its navigator header. The page title sits on the left, the account
initials button sits on the right, and the button opens `/account`.

A screen adds its own controls to the rail with `navigation.setOptions({ headerRight })`; the
`header` render prop in `(tabs)/_layout.tsx` passes them through as `actions`. The library screen
is the one caller, adding the button that opens `/library-categories`.

## Sheets

Eight routes are sheets: `/account`, `/player`, `/library-categories`, `/category/:kind`,
`/collection/:kind/:id`, `/tag/:tagId`, `/artist/:id`, and `/add-to-playlist`. The last two are
opened from the now playing sheet's `...` menu, so they stack on top of `/player`. All are root stack routes presented with
`sheetScreenOptions` from `@/lib/theme`, the single definition of what a sheet looks like: a
rounded `formSheet` at the `SHEET_DETENT` detent with a visible native grabber. That detent is
`1`, the system's large one, so a sheet is full width, runs to the bottom edge, and stops just
below the status bar. Anything smaller gets iOS 26's inset card, which leaves gaps down the
sides and along the bottom. All render their body inside
`SheetScreen` (`@/components/ui/sheet-screen`), which draws the title and the close button and
handles the safe area. Any of them closes with the X or a drag down.

`SheetScreen` also puts `InsideSheetContext` around its body, which is how
`useScreenOverlayInsets` knows to stop padding for the tab bar and the compact player. Those are
behind the sheet, not under its content.

Anything drilled into from the library is a sheet, so browsing never leaves the tab: Library ->
Playlists -> one playlist's songs is three stacked sheets and the tab bar never moves.

`/player` is pushed by the mini player rather than by a header button. It redirects back if
playback stops while it is open.

## Connects to

- `@/lib/account`, `@/lib/apple-music-auth`, `@/lib/playback` for the providers.
- `@/lib/routes/*` and `@/lib/musickit-hooks` for data.
- `@/features/cadenza` from the Cadenza tab.
- `@/components/custom` and `@/components/ui` for everything rendered.

## Gotchas

- Routes inside `(tabs)` inherit the group's auth guard. Protected root stack routes still need
  their own guard.
- A new top-level route also needs a `Stack.Screen` entry in `_layout.tsx` if you want anything
  other than the default header. A new **sheet** route additionally needs its segment in
  `SHEET_SEGMENTS` in `@/lib/screen-overlay`, or presenting it will relayout the screen it
  covers and drop the mini player.
- A new scrolling screen has to apply a bottom inset from `useScreenOverlayInsets`. The bars do
  not reserve space.
- Tab order in the bar is set by the order of `Tabs.Screen` children, not by filename.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
