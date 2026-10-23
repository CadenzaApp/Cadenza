# account

The Account sheet and the settings sheets it opens. Synced settings (mode, background, accent,
glass, color slots, explicit filter, tag suggestions) go through `useUserSettings` to
`GET/PATCH /settings`.

## Files

| file                            | role                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account-settings.tsx`          | `/account`. Avatar, username, and email (the header opens `/account-details`), Apple Music card, the Listening and Appearance tiles, Privacy and Apple Music limits rows. |
| `apple-music-settings.tsx`      | `/apple-music`. Connection status, connect or reconnect, library sync, and disconnect.                                                                              |
| `listening-preferences.tsx`     | `/listening-preferences`. Tag suggestions and Hide explicit content toggles.                                                                                        |
| `appearance-settings.tsx`       | `/appearance`. Mode (System, Light, Dark, Custom), background, accent, glass tint, Clear or Tinted glass, a live preview, and reset.                                |
| `privacy-settings.tsx`          | `/privacy`. What Cadenza keeps and what it does not, and the way into Your data.                                                                                    |
| `account-details.tsx`           | `/account-details`. Name and member since, the username and bio form, view public profile, Your data, Cadenza sign out.                                          |
| `your-data.tsx`                 | `/your-data`. Profile, the counts from `GET /profile/data`, and every saved setting, as tables. Delete account opens a confirm that does nothing yet, and says so.               |
| `apple-music-limits.tsx`        | `/apple-music-limits`. What MusicKit and the Apple Music API do not allow.                                                                                         |
| `profile-form.tsx`              | `ProfileForm`, the only username and bio editor. `PATCH /profile`.                                                                                                  |
| `account-avatar.tsx`            | `AccountAvatar`, `useAccountIdentity` (display name and initial), and `memberSince`.                                                                              |
| `apple-music-connection.ts`     | Shared by the card and the sheet: `appleMusicStatus`, `useConnectAppleMusic`, `useLastSyncedLabel`.                                                                 |
| `settings-ui.tsx`               | `SettingsSheet`, sections, rows, groups, tiles, explainer cards (`SettingsPoints`), plain accent icons, status dots, `SaveError`.                                                                       |
| `apple-music-session-guard.tsx` | `AppleMusicSessionGuard`: renders nothing, opens `/account` once when Apple rejects the stored music-user token. Mounted in `src/app/_layout.tsx`.                  |

## How it works

Every screen here is a `SettingsSheet` (a `DetailScreen` sheet with a padded scroll body) from
`settings-ui.tsx`, and saves through `useSaveSettings` with `SaveError` for the failure line. Each tile and row on `/account` pushes its own sheet.

The display name is `profile.username` from `useProfile`, with the email local part while it
loads. Username and bio are edited only in account details. Your public page is read only; its
Edit button (reached from the Social tab's Me button or View public profile) opens account details.

Sync now calls `useAppleMusicSync().syncNow` from `@/lib/song-init`. It joins the startup sync if
one is running, then refreshes every library read. "Last synced" is per device and account.

Hide explicit content applies in `MusicList`, `CollectionList`, `/queries/results`, and every
queue. A song the user taps to start still plays.

`sessionExpired` means an Apple Music read failed authentication twice. It does not prove the
token expired. The card shows "Needs attention" and a Reconnect pill.

Every setting saves optimistically and rolls back if the PATCH fails. Listening and Appearance
show an error line. Color grids stay read only until the saved slots load, so an edit cannot save
the presets over them.

## Connects to

- `@/lib/routes/settings` for every saved setting, `@/lib/theme` for colors.
- `@/lib/song-init` for sync, `@/lib/apple-music-auth` for the connection.
- `@/lib/use-open-social-profile` to leave the sheet and open your Social tab profile.

## Gotchas

- Apple Music exposes connection status, not an account email or display name.
- Custom mode draws `customBackground(settings)` from `@/lib/swatch-sets` and picks light or dark text from its brightness
  (`schemeForBackground` in `@/lib/theme/tokens.ts`). Cards, borders, and inputs are mixed from
  the background in `resolvePalette`. The Background grid only shows in Custom mode.
- Every saved color grid (accent, glass tint, background, tag colors) is an entry in
  `SWATCH_SETS` (`@/lib/swatch-sets.ts`): presets, rows and columns, the slots key, and what is
  picked when the pick is removed. A new grid is a new entry plus `<SettingsSwatchGrid kind>`.
  Reset to defaults leaves the slots alone.
- Clear or Tinted recreates iOS 26.1's Liquid Glass setting, which apps cannot read. Tinted lays
  the card color over top level glass in `GlassSurface`.
- Pressable styling follows the rule in `src/components/README.md`: `className` with
  `active:opacity-60`, no style function.
- Your data lists the server counts in the order `user_data_counts` returns them, so a new
  table is a backend entry only. Settings rows come from `SETTING_ROWS`, keyed by
  `UserSettings`, so a new setting fails to compile until it is listed.
- New sheets need a `Stack.Screen` with `sheetScreenOptions` in `src/app/_layout.tsx`.

---

Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).
