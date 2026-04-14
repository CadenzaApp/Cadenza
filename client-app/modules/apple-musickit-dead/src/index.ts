import { requireNativeModule } from 'expo-modules-core';
import type { AuthResult } from './AppleMusicKit.types';

interface AppleMusicKitNativeModule {
  authorize(developerToken: string): Promise<AuthResult>;
}

const native = requireNativeModule<AppleMusicKitNativeModule>('AppleMusicKit');

/**
 * Requests authorization to access the user's Apple Music account and retrieves
 * a Music User Token that can be used to make authenticated Apple Music API requests.
 *
 * @param developerToken - A signed JWT developer token obtained from your backend.
 *   - On **iOS**: passed to `SKCloudServiceController.requestUserToken(forDeveloperToken:)`
 *     after the system authorization dialog is approved, to retrieve the Music User Token.
 *   - On **Android**: passed to the Apple MusicKit SDK's `AuthenticationManager` to launch
 *     the Apple Music sign-in activity, which returns the Music User Token directly.
 *
 * Generate this token server-side using your MusicKit private key (.p8 file) and
 * never hardcode it in the client app.
 *
 * @returns A promise that resolves to an {@link AuthResult} containing the authorization
 *   status and, on success, the Music User Token.
 */
export async function authorize(developerToken: string): Promise<AuthResult> {
  return native.authorize(developerToken);
}

export type { AuthResult, AuthStatus } from './AppleMusicKit.types';
