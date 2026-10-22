# account

The Account sheet and the settings sheets it opens. Settings that matter across devices (theme,
accent, glass, explicit filter, tag suggestions) save to `GET/PATCH /settings` through
`useUserSettings`.

## Files

| file                            | role                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account-settings.tsx`          | `/account`. Avatar, username, email, public profile pill, Apple Music card, the two tiles, Privacy and Account details rows, Cadenza sign out.     |
| `apple-music-settings.tsx`      | `/apple-music`. Connection status, connect or reconnect, library sync, and disconnect.                                                             |
| `listening-preferences.tsx`     | `/listening-preferences`. Tag suggestions and Hide explicit content toggles.                                                                       |
| `appearance-settings.tsx`       | `/appearance`. Mode (System, Light, Dark, Custom), background, accent, glass tint, Clear or Tinted glass, a live preview, and reset.               |
| `privacy-settings.tsx`          | `/privacy`. Read only: what Cadenza keeps and what it does not.                                                                                    |
| `account-details.tsx`           | `/account-details`. Email and username. The username row opens the social page, where it is edited.                                                |
| `apple-music-connection.ts`     | Shared by the card and the sheet: `appleMusicStatus`, `useConnectAppleMusic`, `useLastSyncedLabel`.                                                |
| `settings-ui.tsx`               | Panels, rows, groups, tiles, plain accent icons, status dots. `GlassPill` lives in `@/components/ui`.                                              |
| `apple-music-session-guard.tsx` | `AppleMusicSessionGuard`: renders nothing, opens `/account` once when Apple rejects the stored music-user token. Mounted in `src/app/_layout.tsx`. |

## How it works

Every screen here is a `DetailScreen` sheet. Each tile and row on `/account` pushes its own sheet.

The display name is `profile.username` from `useProfile`, with the email local part while it
loads. Username and bio are edited on the social page, not here.

Sync now calls `useAppleMusicSync().syncNow` from `@/lib/song-init`. It joins the startup sync if
one is running, then refetches every library read. "Last synced" is per device.

`sessionExpired` means an Apple Music read failed authentication twice. It does not prove the
token expired. The card shows "Needs attention" and a Reconnect pill.

Setting toggles save optimistically. A failed PATCH rolls the value back and shows a line under
the controls.

## Connects to

- `@/lib/routes/settings` for every saved setting, `@/lib/theme` for colors.
- `@/lib/song-init` for sync, `@/lib/apple-music-auth` for the connection.
- `@/lib/use-open-social-profile` to leave the sheet and open your Social tab profile.

## Gotchas

- Apple Music exposes connection status, not an account email or display name.
- Custom mode draws `background_color` and picks light or dark text from its brightness
  (`schemeForBackground` in `@/lib/theme/tokens.ts`). Cards, borders, and inputs are mixed from
  the background in `resolvePalette`. The Background grid only shows in Custom mode.
- Accent's Default and tint's None are fixed. Removing the selected color falls back to them.
  The grids are `SwatchGrid` from `@/components/custom/color-picker`.
  Slots save as `accent_swatches` / `glass_tint_swatches`; null means `ACCENT_PRESETS` /
  `GLASS_TINT_PRESETS` in `@/lib/theme/tokens.ts`.
- Clear or Tinted recreates iOS 26.1's Liquid Glass setting, which apps cannot read. Tinted lays
  the card color over top level glass in `GlassSurface`.
- Give a `Pressable` its layout through `className` (`active:opacity-60` for feedback). A `style`
  function loses its layout under nativewind.
- New sheets need a `Stack.Screen` with `sheetScreenOptions` in `src/app/_layout.tsx`.

---

Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).
