# app

expo-router routes. The file tree is the navigation tree. Screens here should stay thin: wire
up hooks from `@/lib`, render components from `@/components` and `@/features`, and keep real
logic out.

## Files

| file | route | role |
| --- | --- | --- |
| `_layout.tsx` | root | Provider stack, theme, the `Stack` navigator, `PortalHost`, `TabBarHost`, `MediaPlayerHost`. |
| `(splashscreen)/index.tsx` | `/` | Calls `tryRestoreSession()`, then replaces to `/library` or `/auth`. |
| `auth/index.tsx` | `/auth` | Sign in / sign up. Takes an `initialMode` search param. |
| `(tabs)/_layout.tsx` | | Protected tab group and the shared top rail. The bar itself is mounted at the root. |
| `(tabs)/social.tsx` | `/social` | Static previews of planned social features. |
| `(tabs)/analytics.tsx` | `/analytics` | Static previews of planned listening analytics. |
| `(tabs)/cadenza.tsx` | `/cadenza` | The boolean query workspace. |
| `(tabs)/library.tsx` | `/library` | Library index: a row per category, then Recently Added. |
| `(tabs)/search.tsx` | `/search` | Search. A tag shelf until you tap the field, then recents, a scope switch, and results (artists, then songs). |
| `account.tsx` | `/account` | Account sheet. Wires `AccountSettingsScreen`. |
| `appearance.tsx` | `/appearance` | Appearance preview sheet. Wires `AppearanceSettingsScreen`. |
| `player.tsx` | `/player` | Now playing sheet. Renders `MediaPlayerExpanded`. |
| `library-categories.tsx` | `/library-categories` | Picks which rows the library shows. |
| `category/[kind].tsx` | `/category/:kind` | One library category's contents. |
| `collection/[kind]/[id].tsx` | `/collection/:kind/:id` | The songs in one album or playlist. |
| `tag/[tagId].tsx` | `/tag/:tagId` | One tag and the songs carrying it. |
| `artist/[id].tsx` | `/artist/:id` | One catalog artist: the artist image and a play button, top songs, then an albums rail. |
| `add-to-playlist.tsx` | `/add-to-playlist` | Picks a library playlist for a song, or makes one. |
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
          ZoomOriginProvider   the rect a pushed screen minimizes back into
            Stack              the routes
            PortalHost         where dialogs and modals render
            TabBarHost         the floating tab bar
            MediaPlayerHost    the global player
```

`LibraryCategoriesProvider` (`@/features/library`) sits inside `ThemeProvider` and wraps both
`Stack` and the hosts, because the library screen reads the category selection and the
`/library-categories` screen writes it, and those are separate routes.

`PlayerDockProvider` and `TabSelectionProvider` wrap the same span, and for the same reason:
both bars are mounted beside `Stack` rather than inside it, and both need state that survives
navigation.

`PortalHost` and `MediaPlayerHost` sit as siblings of `Stack`, not inside it, so both survive
navigation. `MediaPlayerHost` only decides whether the player renders; every offset comes from
`@/lib/screen-overlay`. Playback state itself is global regardless, since it lives in
`PlaybackProvider`.

Auth gating for the five primary screens is centralized in `(tabs)/_layout.tsx`:

```tsx
const { account } = useAccount();
if (!account) return <Redirect href="/auth?initialMode=signin" />;
```

The Account and Appearance sheets have their own guards because they are root stack routes. The splash screen owns
session restore, which is why `AccountProvider` has no loading state. Successful restore and
authentication both land on `/library`.

## The floating bottom bars

**Neither bar is inside the navigator.** `TabBarHost` and `MediaPlayerHost` are siblings of
`Stack` in `_layout.tsx`, so both float over whatever route is on top: a tab, or a detail screen
pushed over one. `(tabs)/_layout.tsx` passes `tabBar={() => null}` and renders no bar at all.
That is what lets drilling into an album or an artist keep the bar you navigate with.

The tab bar is `position: "absolute"`, a rounded pill inset from the edges, drawn on a
`GlassSurface`. The compact media player floats as a matching pill above it. Content scrolls
**behind** both and shows in the gutters beside them.

Because neither bar is in the layout, nothing reserves space for them. Every scrolling surface
has to pad itself with `contentBottomInset` or `listBottomInset` from
`@/lib/screen-overlay::useScreenOverlayInsets`. Miss it on a new screen and its last row hides
under the pill. That hook also decides whether the bars render at all, off the route segment and
whether a keyboard is open.

The selected tab gets its own glass bubble, and the bubble slides between tabs rather than
jumping. All of that is `@/components/custom/tab-bar`, which owns the tab order in `TABS`,
draws the bar and the bubble, and navigates with `router.navigate` so a tab press pops back to
the tabs rather than stacking another copy of them. Which tab is lit comes from the route
segments, because there is no navigator above the bar to ask.

Scrolling a page down docks the mini player into the bar: it takes the middle three slots, the
tab you are on slides to the far left, Search holds the right, and the rest fade out and stop
taking presses. On Search both ends would be the same tab, so the left slot shows the tab you
came from instead, unlit. `TabSelectionProvider` is what remembers it. Scrolling back to the top floats it again, and it can be dragged either way at
any time. The state is `@/lib/player-dock`; screens opt in by spreading `useScreenScroll()`
(`@/lib/screen-scroll`) onto their top-level scroller, which is also what makes pressing the
current tab scroll it to the top.

`TabBarButton` carries the whole item, not just the icon, so a moved tab is hit where it is seen.

## Closing a pushed screen

A pushed detail route does not slide in or out. It grows out of the artwork that opened it and
shrinks back into it, the way Music does, over the screen it came from. The X plays the same
animation as the pull. Overscrolling at the top previews the shrink under your finger; letting go
past the threshold finishes from that exact progress and pops. The pull does not stop moving at
the threshold while the finger continues down.

Because it is a card over another screen rather than a rectangle replacing it, it keeps rounded
continuous corners while it shrinks. The visible corner size is compensated for the card's scale,
and the card lands its top-left edge on the artwork rather than hovering around its center.

Both hero screens paint the artwork tint as their own background rather than leaving it to the
gradient inside the list. During the close, the list counters iOS's downward overscroll so the
hero stays anchored near the card's top edge instead of opening a large empty area above it.

That is `@/lib/zoom-dismiss`: rows record where their artwork is before they navigate, the screen
wraps itself in a card that shrinks toward that rect, and `useCloseScreen` is what the X calls.
The artist album rail records its covers too, so an album opened from an artist returns to the
right tile. `useScreenScroll` drives the pull through the same controller, and `useIsPushedDetailScreen`
(`@/lib/screen-overlay`) keeps all of it off the tabs and off the sheets, which drag down natively
already.

## The top rail

Every tab uses `TopRail` as its navigator header. The page title sits on the left, the account
initials button sits on the right, and the button opens `/account`.

A screen adds its own controls to the rail with `navigation.setOptions({ headerRight })`; the
`header` render prop in `(tabs)/_layout.tsx` passes them through as `actions`. The library screen
is the one caller, adding the button that opens `/library-categories`.

## Sheets

**Three** routes are sheets: `/account`, `/appearance`, and `/player`. A sheet is a native surface
over the whole app, so both bottom bars are behind it and unreachable from it. Appearance stacks
from Account and keeps the same modal context. They are presented
with `sheetScreenOptions` from `@/lib/theme`, the single definition of what a sheet looks like:
a rounded `formSheet` at the `SHEET_DETENT` detent with a visible native grabber. That detent is
`1`, the system's large one, so a sheet is full width, runs to the bottom edge, and stops just
below the status bar. Anything smaller gets iOS 26's inset card, which leaves gaps down the
sides and along the bottom. Either closes with the X or a drag down.

Every other detail route covers the screen full bleed with the bars floating over it:
`/collection/:kind/:id`, `/category/:kind`, `/tag/:tagId`, `/artist/:id`, `/library-categories`,
and `/add-to-playlist`. Their segments are listed in `FULL_SCREEN_BAR_SEGMENTS` in
`@/lib/screen-overlay`, which is what turns the bars on over them. Drilling into an album keeps
the tab bar and the mini player, the way Music does.

All six take `pushedScreenOptions()` from `@/lib/theme`: a transparent modal with **no native
animation**. That is what the zoom below needs, since it has to grow out of and shrink back into a
screen that is still on display underneath. The cost is the native back swipe, which a transparent
modal has no edge for; the pull down at the top replaces it.

## The detail shell

Both kinds render their body inside `DetailScreen` (`@/components/ui/detail-screen`), which
draws the title, an optional `headerRight`, and the X, and pays the safe area. One `presentation`
prop is the whole difference: a sheet starts below the status bar and gets the grabber's worth of
top padding, a screen pays the full top inset. It also sets `InsideSheetContext`, which is how
`useScreenOverlayInsets` knows whether the bars are over this content or behind it.

`/player` is pushed by the mini player rather than by a header button. It redirects back if
playback stops while it is open.

`/artist/:id` and `/collection/:kind/:id` are the odd ones out of the pushed routes. Both draw a
hero of their own above the track list instead of a `DetailScreen` header, and float their own X
in the same corner. The artist image runs to the top edge and under the status bar; the
collection centers the cover, the name, the artist, a genre and year line, and Music's three
buttons: a shuffle circle, Play, and a `...` circle that opens a collection options modal. That
modal is a placeholder carrying Play next and Add to queue; the rest of it is still to build.
Under the last row it prints the song count and running time, but only once every page is in,
since a count off a half-loaded list is a wrong number. Everything the collection draws over its
tint is white, on every cover: text that flips to black on a pale album is a screen that changes
shape depending on what you tapped. Either way the hero is the `MusicList` header, because that list owns the scroll.

`/artist/:id` is reached from the Search tab's Artists section, the library's Artists category,
and the now playing sheet's `...` menu. `/collection/:kind/:id` is reached through
`collectionRoute` and `albumRouteForTrack` in `@/lib/music-routes`, which carry the title, the
artist, both artwork sizes, and the artwork color so the hero and the tint are there before the
song fetch lands.

## Connects to

- `@/lib/account`, `@/lib/apple-music-auth`, `@/lib/playback` for the providers.
- `@/lib/routes/*` and `@/lib/musickit-hooks` for data.
- `@/features/account` from the Account and Appearance sheets.
- `@/features/cadenza` from the Cadenza tab.
- `@/components/custom` and `@/components/ui` for everything rendered.

## Gotchas

- Routes inside `(tabs)` inherit the group's auth guard. Protected root stack routes still need
  their own guard.
- A new top-level route also needs a `Stack.Screen` entry in `_layout.tsx` if you want anything
  other than the default header. A new **sheet** route additionally needs its segment in
  `SHEET_SEGMENTS` in `@/lib/screen-overlay`, or presenting it will relayout the screen it
  covers. A new **pushed** route that should show the bars needs its segment in
  `FULL_SCREEN_BAR_SEGMENTS` in the same file, or it renders with neither.
- Reordering the tabs happens in `TABS` in `@/components/custom/tab-bar`, not here. This file
  only maps over it.
- A new scrolling screen has to apply a bottom inset from `useScreenOverlayInsets`. The bars do
  not reserve space.
- Tab order in the bar is set by the order of `Tabs.Screen` children, not by filename.

---

Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
