# onboarding

Getting into the app: splash, Cadenza login, then the Apple Music connect step.

## Files

| file                             | role                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `onboarding-step.ts`             | `onboardingStep()`, pure: `login`, `connect`, `app`, or `pending`. `ONBOARDING_HREF` per step. |
| `use-onboarding.ts`              | `useOnboarding()`: the step for the current account, and `finishConnectStep()`.                |
| `connect-step-store.ts`          | Per account, per device flag in AsyncStorage: got past the connect step.                       |
| `splash-screen.tsx`              | `/`. Restores the session, waits for settings and Apple Music, then replaces to the step.      |
| `login-screen.tsx`               | `/auth`. Email and password, sign in or sign up.                                               |
| `connect-apple-music-screen.tsx` | `/auth/apple-music` (`mode="onboarding"`) and `/reconnect-apple-music` (`mode="reconnect"`).   |
| `auth-error-message.ts`          | Supabase auth error to one plain sentence.                                                     |
| `onboarding-backdrop.tsx`        | Full screen nebula page, the wordmark, and the nebula colors.                                  |

## How it works

Splash, login, connect, and the `(tabs)` guard all route on `useOnboarding().step`, so they agree.
Each screen redirects when the step is no longer its own: signing in moves login on, connecting or
skipping moves connect on, and signing out (the back button on connect) sends it back to login.

The connect step shows once per account per device. Connecting or skipping marks it done. After
that a dropped connection never sends someone back through onboarding: `AppleMusicSessionGuard`
opens `/reconnect-apple-music` as a modal instead.

## Gotchas

- `pending` means Apple Music tokens or the stored flag are still loading. Do not route on it.
- The Apple Music connection is per device, not per account, so a second account on the same
  phone starts out connected.
