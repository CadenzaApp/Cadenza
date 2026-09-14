# account

The Account and Appearance sheets. Account owns the working Cadenza and Apple Music session
actions. Appearance and the other marked settings are local previews only.

## Files

| file | role |
| --- | --- |
| `account-settings.tsx` | Account cards, authentication actions, content toggle, privacy, and sync stub. |
| `appearance-settings.tsx` | Session-only color controls and preview. |
| `settings-ui.tsx` | Shared glass panels, rows, icons, TODO badge, and toggle. |

## How it works

Both routes stay standard `DetailScreen` sheets. Signing out of Cadenza uses the existing
Supabase provider. Signing out of Apple Music clears only the local MusicKit authorization.
Both destructive actions go through the same glass confirmation dialog.

The account avatar and action surfaces use neutral glass. Destructive button labels and icons
carry the red treatment without tinting the entire surface.

The explicit-content toggle and all Appearance selections live only in component state. Sync
shows local unavailable feedback and does not call MusicKit or the backend.

## Connects to

- `@/lib/account` for the Cadenza session.
- `@/lib/apple-music-auth` for Apple Music authorization.
- `@/components/ui/glass-*` for every visible surface and action.

## Gotchas

- Apple Music exposes connection status, not an account email or display name.
- Do not persist or apply the TODO settings until their product behavior is defined.
- `/appearance` is a sheet stacked from `/account`, not a pushed detail screen.

---
Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).
