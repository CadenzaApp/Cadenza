# app

expo-router routes. The file tree is the navigation tree. Screens here should stay thin: wire
up hooks from `@/lib`, render components from `@/components` and `@/features`, and keep real
logic out.

## Files

| file                                 | route                     | role                                                                                                          |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `_layout.tsx`                        | root                      | Provider stack, theme, the root `Stack` navigator, and `PortalHost`.                                          |
| `(splashscreen)/index.tsx`           | `/`                       | Calls `tryRestoreSession()`, then replaces to `/library` or `/auth`.                                          |
| `auth/index.tsx`                     | `/auth`                   | Sign in / sign up. Takes an `initialMode` search param.                                                       |
| `(tabs)/_layout.tsx`                 |                           | Protected native tab group, its five triggers, and the media-player bottom accessory.                         |
| `(tabs)/*/_layout.tsx`               |                           | One native `Stack` per tab, using `TabStack` for the shared top rail.                                         |
| `(tabs)/social/index.tsx`            | `/social`                 | Static previews of planned social features.                                                                   |
| `(tabs)/analytics/index.tsx`         | `/analytics`              | The overview: header, #1 hero, stats, heatmap, tag rail, the chart, and one card for every ranking.           |
| `(tabs)/analytics/[dimension].tsx`   | `/analytics/[dimension]`  | One full ranking. `dimension` is a name from the client's dimension registry.                                 |
| `(tabs)/cadenza/index.tsx`           | `/cadenza`                | The simple / advanced query workspace and shared result preview.                                              |
| `(tabs)/library/index.tsx`           | `/library`                | Library index: a row per category, then Recently Added.                                                       |
| `(tabs)/library/category/[kind].tsx` | `/library/category/:kind` | One category's normal Library-stack view; preserves the tab bar and bottom player.                            |
| `(tabs)/search/index.tsx`            | `/search`                 | Search. A tag shelf until you tap the field, then recents, a scope switch, and results (artists, then songs). |
| `account.tsx`                        | `/account`                | Account sheet. Wires `AccountSettingsScreen`.                                                                 |
| `appearance.tsx`                     | `/appearance`             | Appearance preview sheet. Wires `AppearanceSettingsScreen`.                                                   |
| `player/_layout.tsx`                 | `/player/*`               | Now playing sheet shell and provider stack for its always-mounted horizontal pager.                           |
| `player/index.tsx`                   | `/player`                 | Opens the always-mounted player pager with Player selected.                                                   |
| `player/comments.tsx`                | `/player/comments`        | Opens the same pager with Comments selected.                                                                  |
| `player/tags.tsx`                    | `/player/tags`            | Opens the same pager with Tags selected and optional focused-song params.                                     |
| `library-categories.tsx`             | `/library-categories`     | Picks which rows the library shows.                                                                           |
| `category/[kind].tsx`                | `/category/:kind`         | Compatibility root host for the shared library-category body.                                                 |
| `collection/[kind]/[id].tsx`         | `/collection/:kind/:id`   | The songs in one album or playlist.                                                                           |
| `query-results.tsx`                  | `/query-results`          | Opaque full-screen query matches with the compact player overlaid when active.                                |
| `tag/[tagId].tsx`                    | `/tag/:tagId`             | One tag and the songs carrying it.                                                                            |
| `artist/[id].tsx`                    | `/artist/:id`             | One catalog artist: the artist image and a play button, top songs, then an albums rail.                       |
| `add-to-playlist.tsx`                | `/add-to-playlist`        | Picks a library playlist for a song, or makes one.                                                            |
| `+not-found.tsx`                     |                           | 404.                                                                                                          |

`(splashscreen)` and `(tabs)` are route groups, so the parentheses do not appear in the url.

## How it works

`_layout.tsx` nests providers, and **the order matters**:

```
GestureHandlerRootView
  AccountProvider          supabase session -> who is signed in
    AppleMusicProvider     apple music auth, restored from secure store
      TasksProvider        background task state
        SongInitProvider   syncs the apple music library into user_songs after auth
          PlaybackProvider     reads the native playback snapshot
            ThemeProvider      light/dark nav theme from nativewind's colorScheme
              MusicListPreferencesProvider persisted music-list presentation preferences
                BottomBarVisibilityProvider   temporary native-tab visibility exceptions
                  ZoomOriginProvider          per-navigation zoom launch measurements
                    Stack                     the routes
                    AppleMusicSessionGuard    opens /account when the apple music token dies
                    TagScoreTracker           scores the tags, artist, and genres of each song played for 5 seconds
                    InterestDecay             decays the user's interest scores once per launch
                    TasksHost                 background task status
                    PortalHost                where dialogs and modals render
```

`LibraryCategoriesProvider` (`@/features/library`) sits inside `ThemeProvider` and wraps both
`Stack` and the hosts, because the library screen reads the category selection and the
`/library-categories` screen writes it, and those are separate routes.

`AppleMusicSessionGuard` (`@/features/account`) renders nothing. It watches
`useAppleMusic().sessionExpired` and pushes `/account` once when Apple has rejected the stored
music-user token, so a library that cannot load turns into a reconnect instead of an error. It
skips the splash and auth routes.

`TagScoreTracker` (`@/lib/tag-scores`) renders nothing. It sits beside the root `Stack` because
it only needs to be inside `PlaybackProvider` and `AccountProvider`, and it sends one
`PATCH /tags/scores` and one `PATCH /social/interests/update` per song that plays for 5 seconds.
See [../lib/README.md](../lib/README.md).

`InterestDecay` (`@/lib/interest-decay`) renders nothing. It sends one
`PATCH /social/interests/decay` per launch as soon as an account is signed in, whether restored
by the splash screen or from a fresh sign in. The social feed service ignores it if it decayed
in the last 6 hours.

`PortalHost` remains beside the root `Stack`. The tab bar and player are inside the `(tabs)`
navigator. `NativeTabs` owns the platform tab bar and its iOS 26 bottom accessory. Playback state
still lives above navigation in `PlaybackProvider`.

Auth gating for the five primary screens is centralized in `(tabs)/_layout.tsx`:

```tsx
const { account } = useAccount();
if (!account) return <Redirect href="/auth?initialMode=signin" />;
```

The Account and Appearance sheets have their own guards because they are root stack routes. The splash screen owns
session restore, which is why `AccountProvider` has no loading state. Successful restore and
authentication both land on `/library`.

## Native tabs and the mini player

`(tabs)/_layout.tsx` uses `expo-router/unstable-native-tabs`, the SDK 57 name for Expo Router's
native tabs API. The five `NativeTabs.Trigger` declarations are the tab order. Search uses the
native `search` role, and iOS 26 draws the system Liquid Glass tab bar without an app-owned
background or selection bubble.

The player is `NativeTabs.BottomAccessory` on iOS 26. `minimizeBehavior="onScrollDown"` lets UIKit
minimize the tab bar from native scrolling, while `usePlacement()` selects the regular or inline
player content. UIKit exposes no public command for setting that placement, so the player has no
direct vertical docking gesture. Its React content still accepts a horizontal swipe to pause and
dismiss the player through UIKit's animated `bottomAccessoryHidden` control, which removes the
whole native glass accessory. Older iOS, Android, and web keep a floating `GlassSurface` fallback
above their native tab bar with the same swipe-away behavior.

Native tabs apply scrolling content insets. `useScreenOverlayInsets` now adds only app spacing
for scroll content and keeps a conservative maximum chrome footprint for absolute controls such
as floating buttons and the selection toolbar. Expo does not expose native tab-bar measurement.
The focused Search state hides both the native bar and the accessory through the existing token
based visibility context.

Expo documents limited native-tab integration with `FlatList`. Cadenza's primary scrollers are
direct children of an iOS `ScreenScrollMarker`, which registers the underlying `UIScrollView`
through the nested native stack for native inset and scroll-to-top integration. `useScreenScroll`
retains its explicit scroll-to-top subscription as a cross-platform fallback.

## Closing a pushed screen

A pushed detail route does not slide in or out. It grows out of the artwork that opened it and
shrinks back into it, the way Music does, over the screen it came from. The X plays the same
animation as the pull. Overscrolling at the top previews the shrink under your finger; letting go
past the threshold finishes from that exact progress and pops. The pull does not stop moving at
the threshold while the finger continues down.

Because it is a card over another screen rather than a rectangle replacing it, it keeps rounded
continuous corners while it shrinks. The visible corner size is compensated for the card's scale,
and the card lands its top-left edge on the artwork rather than hovering around its center.

The artwork hero screens paint the artwork tint as their own background rather than leaving it to the
gradient inside the list. During the close, the list counters iOS's downward overscroll so the
hero stays anchored near the card's top edge instead of opening a large empty area above it. The
gradient is always at least one viewport tall, so short albums and playlists do not end in a flat
color band.

That is `@/lib/zoom-dismiss`: rows create a launch ticket and measure their artwork before they
navigate. The destination claims that ticket and keeps its own rect, so nested screens cannot
replace one another's close targets. The screen wraps itself and its compact player in a card that
shrinks toward that rect, and `useCloseScreen` is what the X calls. The artist album rail records
its covers too, so an album opened from an artist returns to the right tile. `useScreenScroll`
drives the pull through the same controller, and `useIsPushedDetailScreen`
(`@/lib/screen-overlay`) keeps all of it off the tabs and off the sheets, which drag down natively
already.

## The top rail

Every tab is a directory with a native `Stack` from `TabStack`. `TopRail` is that stack's
header. The page title sits on the left, the account
initials button sits on the right, and the button opens `/account`.

The rail floats over the page; it is not part of it. The screen's scroller pads its content's top
by the rail's measured height plus `RAIL_CONTENT_GAP`, the same on every page, replacing the page's
own top padding. At rest the page sits that gap under the rail. Scrolling down fades the rail away
and the page runs up under the status bar; it only fades back in once the page is at the top. The
page never moves to make room. `TabStack` wraps its stack in `TopRailProvider` (`@/lib/top-rail`),
and `useScreenScroll` supplies the padding and drives the fade, so any screen whose scroller spreads
that hook gets this. The rule is `nextRailShown` in `@/lib/top-rail-geometry`, tested. Content
drawn outside the scroller, like a loading skeleton, pads itself with `useTopRailInset()`, which is
null with no floating rail so the content keeps its own.

A screen with a fixed bar above its scroller is listed in `TabStack`'s `pinnedRail`, which keeps
its rail as a plain bar above the screen that never hides: Cadenza, Search, and the Analytics
detail pages. Android always pins, since its scroll views have no content inset.

A screen adds its own controls to the rail with `navigation.setOptions({ headerRight })`; the
`header` render prop in `(tabs)/_layout.tsx` passes them through as `actions`. The library screen
is the one caller, adding the button that opens `/library-categories`.

## Sheets

**Three** routes are sheets: `/account`, `/appearance`, and `/player`. A sheet is a native surface
over the whole app, so it covers the primary native tab bar and compact player while leaving them
mounted underneath. Appearance stacks from Account and keeps the same modal context. They are presented
with `sheetScreenOptions` from `@/lib/theme`, the single definition of what a sheet looks like:
a rounded `formSheet` at the `SHEET_DETENT` detent with a visible native grabber. That detent is
`1`, the system's large one, so a sheet is full width, runs to the bottom edge, and stops just
below the status bar. Anything smaller gets iOS 26's inset card, which leaves gaps down the
sides and along the bottom. Either closes with the X or a drag down.

Root detail routes are presented above the tab navigator. `PUSHED_DETAIL_SEGMENTS` in
`@/lib/screen-overlay` only identifies routes that need the custom pull-down close. Query results
is a normal opaque root-stack screen and uses the navigator's standard transition and back action.

All pushed details take `pushedScreenOptions()` from `@/lib/theme`: a transparent modal with **no native
animation**. That is what the zoom below needs, since it has to grow out of and shrink back into a
screen that is still on display underneath. The cost is the native back swipe, which a transparent
modal has no edge for; the pull down at the top replaces it.

## The detail shell

Both kinds render their body inside `DetailScreen` (`@/components/ui/detail-screen`), which
draws the title, an optional `headerRight`, and the X, and pays the safe area. One `presentation`
prop is the whole difference: a sheet starts below the status bar and gets the grabber's worth of
top padding, a screen pays the full top inset. It also sets `InsideSheetContext`, which keeps
`useScreenOverlayInsets` in sheet-local coordinates.

`/player` is pushed by the mini player rather than by a header button. It is a root sheet whose
three routes all render one always-mounted Comments / Player / Tags pager. Song menus edit tags in
their own `TagSelector` popup instead of routing through this sheet.

The player sheet paints one tint in `DetailScreen`, behind its header and the transparent pager.
All three pages stay mounted side by side, so a swipe reveals live adjacent content continuously
instead of navigating after a threshold. The custom glass selector follows the same scroll offset.

`/artist/:id`, `/collection/:kind/:id`, `/tag/:tagId`, and `/query-results` use the
shared `TrackCollectionView` instead of a `DetailScreen` header, and float their own X in the
same corner. The artist supplies its full-bleed image hero and albums rail as custom header and
footer content. The collection uses the standard single-artwork layout with Play/Pause, Shuffle,
and a caller-supplied action that opens `CollectionOptionsMenu`. A tag uses the standard mosaic,
uses its tag pill and song count as the title, and supplies its tag color as the page color,
and offers rename, recolor, and delete actions. Query results use the standard
weighted mosaic and an edge-to-edge tint, but use a normal opaque stack presentation rather than
the collection's zoom transition. Each gradient-backed `TrackCollectionView` also paints fixed
start and end colors beneath the list, so either elastic overscroll edge meets the scrolling
gradient without a seam. `TrackCollectionView` turns every route's source color into the shared
mode-aware Oklch gradient object; callers provide only that source color.
Under the last row it prints the song count and running time, but only once every page is in,
since a count off a half-loaded list is a wrong number. Everything the collection draws over its
tint stays inside the same scroll surface. Either way the hero is the `MusicList` header inside
`TrackCollectionView`, because that list owns the scroll.

`/artist/:id` is reached from the Search tab's Artists section, the library's Artists category,
and the now playing sheet's `...` menu. `/collection/:kind/:id` is reached through
`collectionRoute` and `albumRouteForTrack` in `@/lib/music-routes`, which carry the title, the
artist, both artwork sizes, and the artwork color so the hero and the tint are there before the
song fetch lands.

These root routes render above the native tab controller, so its bottom accessory cannot appear
over them. Every zoom-dismiss card owns a compact player layer, which makes the player transform
with that card and lets a nested close reveal the parent card's already-mounted player. Query
results do not use a zoom card, so `MediaPlayerPushedScreenOverlay` hosts their compact player at
the root through an iOS full-window overlay. The shared route predicate still makes all of these
lists reserve exactly the compact player's height.

## Connects to

- `@/lib/account`, `@/lib/apple-music-auth`, `@/lib/playback` for the providers, and
  `@/lib/tag-scores` for the tag scoring the root layout mounts.
- `@/lib/routes/*` and `@/lib/musickit-hooks` for data.
- `@/features/account` from the Account and Appearance sheets.
- `@/features/cadenza` from the Cadenza tab, which toggles between `@/features/query-builder`
  and `@/features/advanced-query-builder` while sharing the current result presentation.
- `@/components/custom` and `@/components/ui` for everything rendered.

## Gotchas

- Routes inside `(tabs)` inherit the group's auth guard. Protected root stack routes still need
  their own guard.
- A new top-level route also needs a `Stack.Screen` entry in `_layout.tsx` if you want anything
  other than the default header. A new **sheet** route additionally needs its segment in
  `SHEET_SEGMENTS` in `@/lib/screen-overlay`, or presenting it will relayout the screen it
  covers. A new **pushed** route needs its segment in `PUSHED_DETAIL_SEGMENTS` only if it uses the
  custom pull-down close. Bar visibility is the default.
- Reordering the tabs means reordering the static `NativeTabs.Trigger` children in
  `(tabs)/_layout.tsx`.
- A new tab needs both a trigger and a directory containing `_layout.tsx` plus `index.tsx`.
- Keep a primary scroller as `ScreenScrollMarker`'s one direct child. The marker registers that
  native scroll view for automatic insets and scroll-to-top behavior.
- Native tabs support at most five items on Android. The current set already uses all five.
- Keep `player/` as a root-stack sibling of `(tabs)`. Its sheet covers the primary tab controller,
  and its Comments / Player / Tags pager is local presentation state rather than navigation.

---

Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
