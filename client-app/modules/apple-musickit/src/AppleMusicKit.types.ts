/**
 * The authorization status returned by the native MusicKit module.
 *
 * - `authorized`     — The user granted access. A `userToken` will be present.
 * - `denied`         — The user explicitly denied access (iOS only).
 * - `restricted`     — Access is restricted by device policy (iOS only).
 * - `notDetermined`  — Authorization has not been requested yet (iOS only).
 * - `failed`         — The auth flow completed but resulted in an error (Android).
 * - `unknown`        — An unrecognised status was returned by the native layer.
 */
export type AuthStatus =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  | 'failed'
  | 'unknown';

/**
 * The result of an `authorize()` call.
 *
 * On **iOS**, after a successful authorization the native layer calls
 * `SKCloudServiceController.requestUserToken(forDeveloperToken:)` to retrieve
 * the Music User Token and includes it in this result.
 *
 * On **Android**, the Apple MusicKit SDK launches an authentication activity
 * and returns the Music User Token directly upon success.
 *
 * In both cases, `userToken` is present when `status === 'authorized'` and the
 * developer token provided to `authorize()` was non-empty.
 */
export interface AuthResult {
  /** The authorization outcome. */
  status: AuthStatus;

  /**
   * The Music User Token for the authenticated user.
   * Present when `status === 'authorized'` and a developer token was supplied.
   * Pass this token in the `Music-User-Token` header of Apple Music API requests.
   */
  userToken?: string;

  /**
   * A human-readable error message.
   * Present when `status === 'authorized'` but user-token retrieval failed,
   * or when `status === 'failed'` on Android.
   */
  error?: string;
}
