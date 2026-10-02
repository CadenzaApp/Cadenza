# account

The Account and Appearance sheets. Account owns the working Cadenza and Apple Music session
actions and shows the user's top tags. Appearance and the other marked settings are local
previews only.

## Files

| file                            | role                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account-settings.tsx`          | Account cards, authentication actions, top tags, suggested-tag display setting, content toggle, privacy, and sync stub.                            |
| `top-tags.tsx`                  | `TopTagsPanel`: the user's 10 highest scored tags as tag pills with their scores.                                                                  |
| `appearance-settings.tsx`       | Session-only color controls and preview.                                                                                                           |
| `settings-ui.tsx`               | Shared glass panels, rows, icons, and the TODO badge.                                                                                              |
| `apple-music-session-guard.tsx` | `AppleMusicSessionGuard`: renders nothing, opens this sheet once when Apple rejects the stored music-user token. Mounted in `src/app/_layout.tsx`. |

## How it works

Both routes stay standard `DetailScreen` sheets. Signing out of Cadenza uses the existing
Supabase provider. Signing out of Apple Music clears only the local MusicKit authorization.
Both destructive actions go through the same glass confirmation dialog.

When `useAppleMusic().sessionExpired` is set, the Apple Music card says the token expired and
to reconnect. That flag is set by `reportAppleMusicAuthFailure()` after an Apple Music read has
taken a 403 twice, and `AppleMusicSessionGuard` is what brings the person here to act on it.

The account avatar and action surfaces use neutral glass. Destructive button labels and icons
carry the red treatment without tinting the entire surface.

`TopTagsPanel` sits between the Apple Music card and the explicit-content toggle. It reads
`useTopTagScores(10)` from `@/lib/routes/tags`, turns the name keyed map into a list sorted by score
and then name, and draws each name with `TagPill`, its score as the pill's count. A `local` name is
a solid pill in the user's tag color, a `global` one an outlined pill in the default tag's color,
the same split the player's Tags page uses. Names come back lowercased, so a tag named `Road Trip`
shows as `road trip`.

The suggested-tag display setting is device-local and persists across launches. It controls only
suggested pills in music-list rows, not the suggested section of a tag selector. The
explicit-content toggle and all Appearance selections live only in component state. Sync shows
local unavailable feedback and does not call MusicKit or the backend.

## Connects to

- `@/lib/account` for the Cadenza session.
- `@/lib/apple-music-auth` for Apple Music authorization.
- `@/lib/music-list-preferences` for the persisted suggested-tag display setting.
- `@/lib/routes/tags::useTopTagScores` and `@/components/custom/tag-pill` for the top tags.
- `@/components/ui/glass-*` for every visible surface and action, including `GlassToggle`.

## Gotchas

- Apple Music exposes connection status, not an account email or display name.
- Do not persist or apply the TODO settings until their product behavior is defined.
- `/appearance` is a sheet stacked from `/account`, not a pushed detail screen.

---

Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).
