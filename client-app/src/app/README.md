# app

expo-router routes. The file tree is the navigation tree. Screens here should stay thin: wire
up hooks from `@/lib`, render components from `@/components` and `@/features`, and keep real
logic out.

## Files

| file                                                                          | route                     | role                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `_layout.tsx`                                                                 | root                      | Provider stack, theme, the root `Stack` navigator, and `PortalHost`.                                          |
| `(splashscreen)/index.tsx`                                                    | `/`                       | `SplashScreen` from `@/features/onboarding`. Restores the session, then replaces to the onboarding step.      |
| `auth/index.tsx`                                                              | `/auth`                   | Onboarding step one, sign in / sign up. Takes an `initialMode` search param.                                  |
| `auth/apple-music.tsx`                                                        | `/auth/apple-music`       | Onboarding step two, connect Apple Music. Back signs out.                                                     |
| `reconnect-apple-music.tsx`                                                   | `/reconnect-apple-music`  | The same connect page as a modal, opened when Apple drops the connection.                                     |
| `(tabs)/_layout.tsx`                                                          |                           | Protected native tab group, its five triggers, and the media-player bottom accessory.                         |
| `(tabs)/(<tab>)/_layout.tsx`                                                  |                           | One native `Stack` per tab, using `TabStack` for the shared top rail.                                         |
| `(tabs)/(social)/social/index.tsx`                                            | `/social`                 | The ranked social feed.                                                                                       |
| `(tabs)/(social)/social/friends.tsx`                                          | `/social/friends`         | Incoming requests, then outgoing requests, then friends. Opened from the feed header.                         |
| `(tabs)/(social)/social/notifications.tsx`                                    | `/social/notifications`   | The signed-in user's notifications, from `GET /social/notifications`. A received friend request has accept and ignore. Opened from the bell next to Friends.   |
| `(tabs)/(social)/social/user/[userId].tsx`                                    | `/social/user/:userId`    | One user's public profile (username, bio) and their posts, newest first. Your own page edits both.            |
| `(tabs)/(analytics)/analytics/index.tsx`                                      | `/analytics`              | The overview: header, #1 hero, stats, heatmap, tag rail, and one card for every ranking.                      |
| `(tabs)/(analytics)/analytics/[dimension].tsx`                                | `/analytics/[dimension]`  | One full ranking. `dimension` is a name from the client's dimension registry.                                 |
| `(tabs)/(analytics)/analytics/listened.tsx`                                   | `/analytics/listened`     | The songs listened to in one heatmap hour. Params: `since`, `until`, `title`, optional `tag`.                 |
| `(tabs)/(cadenza)/cadenza/index.tsx`                                          | `/cadenza`                | The simple / advanced query workspace and shared result preview.                                              |
| `(tabs)/(library)/library/index.tsx`                                          | `/library`                | Library index: a row per category, then Recently Added.                                                       |
| `(tabs)/(library)/library/category/[kind].tsx`                                | `/library/category/:kind` | One library category.                                                                                         |
| `(tabs)/(search)/search/index.tsx`                                            | `/search`                 | Search. A tag shelf until you tap the field, then recents, a scope switch, and results (artists, then songs). |
| `(tabs)/(analytics,cadenza,library,search,social)/collection/[kind]/[id].tsx` | `/collection/:kind/:id`   | The songs in one album or playlist.                                                                           |
| `(tabs)/(analytics,cadenza,library,search,social)/tag/[tagId].tsx`            | `/tag/:tagId`             | One tag and the songs carrying it.                                                                            |
| `(tabs)/(analytics,cadenza,library,search,social)/artist/[id].tsx`            | `/artist/:id`             | One catalog artist: the artist image and a play button, top songs, then an albums rail.                       |
| `(tabs)/(analytics,cadenza,library,search,social)/discuss/[songId].tsx`       | `/discuss/:songId`        | Posts about one song, outside the now playing sheet.                                                          |
| `(tabs)/(analytics,cadenza,library,search,social)/query-results.tsx`          | `/query-results`          | Query matches.                                                                                                |
| `account.tsx`                                                                 | `/account`                | Account sheet. Wires `AccountSettingsScreen`.                                                                 |
| `assistant.tsx`                                                               | `/assistant`              | The assistant chat sheet. Wires `AssistantChat`. Opened from the button at the right end of the bottom row, on every screen in the tabs. |
| `appearance.tsx`                                                              | `/appearance`             | Appearance sheet: mode, accent, glass. Wires `AppearanceSettingsScreen`.                                      |
| `apple-music.tsx`                                                             | `/apple-music`            | Apple Music sheet: status, sync, connect, disconnect.                                                         |
| `listening-preferences.tsx`                                                   | `/listening-preferences`  | Tag suggestions and Hide explicit content toggles.                                                            |
| `privacy.tsx`                                                                 | `/privacy`                | What Cadenza stores. Read only.                                                                               |
| `account-details.tsx`                                                         | `/account-details`        | Username and bio editor, Your data, sign out.                                                                 |
| `your-data.tsx`                                                               | `/your-data`              | Everything Cadenza keeps about you, and Delete account (not wired up yet).                                    |
| `apple-music-limits.tsx`                                                      | `/apple-music-limits`     | What Apple does not let Cadenza do. Read only.                                                                |
| `player/_layout.tsx`                                                          | `/player/*`               | Now playing sheet shell and provider stack for its always-mounted horizontal pager.                           |
| `player/index.tsx`                                                            | `/player`                 | Opens the always-mounted player pager with Player selected.                                                   |
| `player/discuss.tsx`                                                          | `/player/discuss`         | Opens the same pager with Discuss selected and optional focused-song params.                                  |
| `player/tags.tsx`                                                             | `/player/tags`            | Opens the same pager with Tags selected and optional focused-song params.                                     |
| `library-categories.tsx`                                                      | `/library-categories`     | Sheet that picks which rows the library shows.                                                                |
| `add-to-playlist.tsx`                                                         | `/add-to-playlist`        | Sheet that picks a library playlist for a song, or makes one.                                                 |
| `+not-found.tsx`                                                              |                           | 404.                                                                                                          |

`(splashscreen)`, `(tabs)`, and each `(<tab>)` are route groups, so the parentheses do not appear in
the url. `(analytics,cadenza,library,search,social)` is a shared group: its routes exist once in
every tab's stack, and expo-router resolves a push to the copy in the current tab.

## How it works

`_layout.tsx` nests providers, and **the order matters**:

```
GestureHandlerRootView
  AccountProvider          supabase session -> who is signed in
    UserSettingsProvider   the user's /settings, read once; the splash waits for it
      AppleMusicProvider     apple music auth, restored from secure store
        TasksProvider        background task state
          SongInitProvider   syncs the apple music library into user_songs after auth
            PlaybackProvider     reads the native playback snapshot
              AppThemeProvider   user's mode, accent, and glass into css vars, nav theme, useAppTheme
                MusicListPreferencesProvider moves the old device-local tag preference onto /settings once
                  BottomBarVisibilityProvider   temporary native-tab visibility exceptions
                    Stack                       the routes
                    AppleMusicSessionGuard      opens /account when the apple music token dies
                    InterestPlayTracker         scores the artist and genres of each song played for 5 seconds
                    InterestDecay               decays the user's interest scores once per launch
                    TasksHost                   background task status
                    PortalHost                  where dialogs and modals render
```

`LibraryCategoriesProvider` (`@/features/library`) sits inside `AppThemeProvider` and wraps both
`Stack` and the hosts, because the library screen reads the category selection and the
`/library-categories` screen writes it, and those are separate routes.

`AppleMusicSessionGuard` (`@/features/account`) renders nothing. It watches
`useAppleMusic().sessionExpired` and pushes `/reconnect-apple-music` once when Apple has rejected
the stored music-user token, so a library that cannot load turns into a reconnect instead of an
error. It skips the splash, auth, and reconnect routes.

`InterestPlayTracker` (`@/lib/interest-play-tracker`) renders nothing. It sits beside the root
`Stack` because it only needs to be inside `PlaybackProvider` and `AccountProvider`, and it sends
one `PATCH /social/interests/update` per song that plays for 5 seconds. See
[../lib/README.md](../lib/README.md).

`InterestDecay` (`@/lib/interest-decay`) renders nothing. It sends one
`PATCH /social/interests/decay` per launch as soon as an account is signed in, whether restored
by the splash screen or from a fresh sign in. The social feed service ignores it if it decayed
in the last 6 hours.

`PortalHost` remains beside the root `Stack`. The tab bar and player are inside the `(tabs)`
navigator. `NativeTabs` owns the platform tab bar and the dockable expanded player on iOS 26+. Playback state
still lives above navigation in `PlaybackProvider`.

Auth gating for the five primary screens is centralized in `(tabs)/_layout.tsx`:

```tsx
if (!account) return null; // SignOutHandler navigates to login
if (step === "connect") return <Redirect href={ONBOARDING_HREF.connect} />;
```

`step` comes from `useOnboarding()` in `@/features/onboarding`, which the splash, login, and
connect screens also route on. The Account and Appearance sheets have their own guards because
they are root stack routes. The splash screen owns session restore, which is why
`AccountProvider` has no loading state.

## Native tabs and the mini player

`(tabs)/_layout.tsx` uses SDK 58's `expo-router/native-tabs` API. The five `NativeTabs.Trigger` declarations are the tab order. Search uses the
native `search` role, and iOS 26 draws the system Liquid Glass tab bar without an app-owned
background or selection bubble.

On iOS 26+, expanded playback uses `NativeTabs.BottomAccessory` with
`minimizeBehavior="onScrollDown"`, including when sort or multiselect is visible.
`NativePlayerAccessory` uses `usePlacement()` to hide artist and skip controls in the smaller
inline frame. Auxiliary controls retain their separate glass surfaces above expanded playback.

`player-presentation.tsx` owns a single motion controller for foreground hosts. Native frames
position auxiliary controls; expansion completion gates native insertion. See the
[media-player guide](../components/custom/media-player/README.md) for gestures and native-patch
setup. Covered hosts do not run gesture reactions.

Native tabs apply scrolling content insets. `useScreenOverlayInsets` now adds only app spacing
for scroll content and keeps a conservative maximum chrome footprint for absolute controls such
as floating buttons and the selection toolbar. A tab screen the native bar floats over, like the
Cadenza query workspace, uses `floatingOverTabBarBottom` instead, which clears the whole bar.
Expo does not expose native tab-bar measurement.
The focused Search state hides both the native bar and the player through the existing token
based visibility context.

Expo documents limited native-tab integration with `FlatList`. Cadenza's primary scrollers are
direct children of an iOS `ScreenScrollMarker`, which registers the underlying `UIScrollView`
through the nested native stack for native inset and scroll-to-top integration. `useScreenScroll`
retains its explicit scroll-to-top subscription as a cross-platform fallback.

## Detail screens

Album, playlist, tag, artist, song discuss, and query results are pushed inside the current tab's
stack, so the tab bar and the native player accessory stay, like Apple Music. Each tab's
`TabStack` registers them with no header; they draw their own and float a back button.

Tiles that open them (`ZoomTile` in `@/components/custom/zoom-tile`) use expo-router's
`Link.AppleZoom`, the iOS 18 zoom transition. The destination's hero artwork is its
`Link.AppleZoomTarget`. Swipe back and the zoom's own drag to dismiss both work natively. Android
and older iOS get a plain push.

## The top rail

Every tab is a group with a native `Stack` from `TabStack`. `TopRail` is that stack's
header. The page title sits on the left, the account
initials button sits on the right, and the button opens `/account`. The Social feed
adds a friends button, a notifications button, and a "Me" button next to create
post. Friends opens `/social/friends`. Notifications, the bell beside Friends,
opens `/social/notifications`. Me pushes `/social/user/:userId` on the social
stack.

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
adds the button that opens `/library-categories`. Cadenza adds query settings, including the
shared suggested-tag matching scope.

## Sheets

The settings routes (`/account`, `/apple-music`, `/listening-preferences`, `/appearance`,
`/privacy`, `/account-details`, `/your-data`, `/apple-music-limits`), the two pickers
(`/library-categories`, `/add-to-playlist`), and `/player` are sheets. A sheet is a native surface
over the whole app, so it covers the primary native tab bar and compact player while leaving them
mounted underneath. Every settings sheet stacks from Account and keeps the same modal context. They are presented
with `sheetScreenOptions` from `@/lib/theme`, the single definition of what a sheet looks like:
a rounded `formSheet` at the `SHEET_DETENT` detent with a visible native grabber. That detent is
`1`, the system's large one, so a sheet is full width, runs to the bottom edge, and stops just
below the status bar. Anything smaller gets iOS 26's inset card, which leaves gaps down the
sides and along the bottom. Either closes with the X or a drag down.

Open a detail screen with `useOpenScreen` (`@/lib/open-screen`) or a `ZoomTile`, not
`router.push`. `useOpenScreen` resets the current tab's stack: opening one already on it goes back
to it, so artist -> playlist -> the same artist lands on the first artist. Past
`MAX_DETAIL_DEPTH` the oldest detail screens are dropped. With `closing: "player"` it also closes
the now playing sheet and opens the screen in the tab underneath. A `ZoomTile` is a plain push.

## The detail shell

Both kinds render their body inside `DetailScreen` (`@/components/ui/detail-screen`), which
draws the title, an optional `headerRight`, and a back button (screen) or X (sheet), and pays the
safe area. One `presentation`
prop is the whole difference: a sheet starts below the status bar and gets the grabber's worth of
top padding, a screen pays the full top inset. It also sets `InsideSheetContext`, which keeps
`useScreenOverlayInsets` in sheet-local coordinates.

`/player` is pushed by the mini player rather than by a header button. It is a root sheet.
`/player`, `/player/discuss`, and `/player/tags` each render one always-mounted Discuss /
Player / Tags pager. The route selects the first page. A song's Discuss action opens
`/discuss/:songId` instead of that sheet. That screen is the posts list for the chosen song:
no "Now Playing" title and no Discuss / Player / Tags selector, and it does not start or
replace whatever is playing. The sheet's own Discuss page is still the pager tab for the
song the sheet is focused on. Tapping an author on either Discuss surface closes that
screen and opens `/social/user/:userId` on the Social tab, with the feed still underneath.
Account details' "View public profile" row uses that same navigation for your own page. The
Social feed's "Me" button pushes `/social/user/:userId` on the social stack, like a feed author
tap. Your own public page is read only; its Edit button opens `/account-details`, the only place a
username and bio are edited.
Song menus edit tags in their own `TagSelector` popup
instead of routing through this sheet.

The player sheet paints one tint in `DetailScreen`, behind its header and the transparent pager.
All three pages stay mounted side by side, so a swipe reveals live adjacent content continuously
instead of navigating after a threshold. The custom glass selector follows the same scroll offset.

`/artist/:id`, `/collection/:kind/:id`, `/tag/:tagId`, and `/query-results` use the
shared `TrackCollectionView` instead of a `DetailScreen` header, and float a
`FloatingBackButton` in the top left. The artist supplies a `BlendedCover` of its portrait and an
albums rail as custom header and footer content. The collection uses the standard single-cover
layout, a `BlendedCover`, with Play/Pause, Shuffle, and a caller-supplied action that opens
`CollectionOptionsMenu`. A tag uses the standard mosaic, uses its tag pill and song count as the
title, supplies its tag color as the nebula's fallback, and offers rename, recolor, and delete
actions. Query results use the standard weighted mosaic. Every `TrackCollectionView` sits on a full
`NebulaBackdrop` fixed to the screen, colored from random spots on its artwork.
Under the last row it prints the song count and running time, but only once every page is in,
since a count off a half-loaded list is a wrong number. Either way the hero is the `MusicList` header inside
`TrackCollectionView`, because that list owns the scroll.

`/artist/:id` is reached from the Search tab's Artists section, the library's Artists category,
and the now playing sheet's artist name and `...` menu. `/collection/:kind/:id` is reached through
`collectionRoute` and `albumRouteForTrack` in `@/lib/music-routes`, which carry the title, the
artist, both artwork sizes, and the artwork color so the hero and the tint are there before the
song fetch lands.

The artist shell and cached hero render immediately, with skeletons for missing data. Its portrait
alpha mask reveals a separate gradient from the sampled portrait color toward a less chromatic,
darker/light-mode lighter Oklch shade over at least three screen heights. Colors change immediately.
Artist and album links in the now playing sheet close it and push in the tab underneath.

Go to Album opens the full catalog album through `useAlbumRouteForTrack`, since a library album
holds only the songs the user added. Its `fallbackId` is the library album, shown when the full one
fails or is empty. Its `highlight` param names the song it came from, and that row shimmers once,
the first time it is on screen.

## Connects to

- `@/lib/account`, `@/lib/apple-music-auth`, `@/lib/playback` for the providers, and
  `@/lib/interest-play-tracker` for the interest scoring the root layout mounts.
- `@/lib/routes/*` and `@/lib/musickit-hooks` for data.
- `@/features/account` from the Account and Appearance sheets.
- `@/features/cadenza` from the Cadenza tab, which toggles between `@/features/query-builder`
  and `@/features/advanced-query-builder` while sharing the current result presentation.
- `@/components/custom` and `@/components/ui` for everything rendered.

## Gotchas

- Routes inside `(tabs)` inherit the group's auth guard. Protected root stack routes still need
  their own guard.
- A new detail route goes in the shared group and in `DETAIL_IDENTITY` (`@/lib/detail-stack`),
  which is also the list `TabStack` registers.
- A new top-level route also needs a `Stack.Screen` entry in `_layout.tsx` if you want anything
  other than the default header. A new **sheet** route additionally needs its segment in
  `SHEET_SEGMENTS` in `@/lib/screen-overlay`, or presenting it will relayout the screen it
  covers.
- Reordering the tabs means reordering the static `NativeTabs.Trigger` children in
  `(tabs)/_layout.tsx`.
- A new tab needs a trigger named `(<tab>)`, a `(<tab>)/_layout.tsx` with `TabStack` and
  `unstable_settings.initialRouteName`, `(<tab>)/<tab>/index.tsx`, and its name added to the shared
  group's folder name.
- Keep a primary scroller as `ScreenScrollMarker`'s one direct child. The marker registers that
  native scroll view for automatic insets and scroll-to-top behavior.
- Native tabs support at most five items on Android. The current set already uses all five.
- Keep `player/` as a root-stack sibling of `(tabs)`. Its sheet covers the primary tab controller,
  and its Discuss / Player / Tags pager is local presentation state rather than navigation.

---

Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
