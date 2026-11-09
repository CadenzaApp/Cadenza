# onboarding

Getting into the app: splash, Cadenza login, then the Apple Music connect step.

## Files

| file                              | role                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboarding-step.ts`              | `onboardingStep()`, pure: `login`, `connect`, `app`, or `pending`. `ONBOARDING_HREF` per step.                                                            |
| `use-onboarding.ts`               | `useOnboarding()`: the step for the current account, and `finishConnectStep()`.                                                                           |
| `connect-step-store.ts`           | Per account, per device flag in AsyncStorage: got past the connect step.                                                                                  |
| `splash-screen.tsx`               | `/`. Restores the session, waits for settings and Apple Music, then replaces to the step.                                                                 |
| `login-screen.tsx`                | `/auth`. Email and password, sign in or sign up.                                                                                                          |
| `connect-apple-music-screen.tsx`  | `/auth/apple-music`, the full screen onboarding step. Back signs out, skip runs on previews.                                                              |
| `reconnect-apple-music-sheet.tsx` | `/reconnect-apple-music`, opened when Apple drops the connection: the onboarding step's content on the shared sheet with the Apple Music nebula.          |
| `auth-error-message.ts`           | Supabase auth error to one plain sentence.                                                                                                                |
| `sign-out-handler.tsx`            | `SignOutHandler`, mounted at the root: on sign out, closes every screen and replaces with login. `PlaybackProvider` stops playback on the account change. |
| `onboarding-backdrop.tsx`         | Full screen nebula page, the wordmark, and the nebula colors.                                                                                             |

## How it works

Splash, login, connect, and the `(tabs)` guard all route on `useOnboarding().step`, so they agree.
Each screen redirects when the step is no longer its own: signing in moves login on, connecting or
skipping moves connect on, and signing out (the back button on connect) sends it back to login.

The connect step shows once per sign in. Connecting or skipping marks it done, and Cadenza sign
out clears the mark. The Apple Music token is kept across a Cadenza sign out, so signing back in
skips the step if Apple Music is still connected, and shows it if they disconnected. While signed
in, a dropped connection never sends someone back through onboarding: `AppleMusicSessionGuard`
opens `/reconnect-apple-music` as a modal instead.

Sign out navigates in one place, `SignOutHandler`: `router.dismissAll()` closes every sheet and
pushed screen, then `router.replace` swaps the tabs for login, so nothing is under it. Screens that
need an account render `null` without one instead of redirecting, since a redirect from inside a
sheet replaces only the sheet, which left login as a dismissable sheet.

## Gotchas

- `pending` means Apple Music tokens or the stored flag are still loading. Do not route on it.
- The Apple Music connection is per device, not per account, so a second account on the same
  phone starts out connected.
- Do not move sign out onto `Stack.Protected`. Tried it: sign out crashed and the login screen's
  redirect to `/auth/apple-music` resolved to not found while the guards were switching.
