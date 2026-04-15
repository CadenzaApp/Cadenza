package expo.modules.applemusickit.AppleMusicKitModule

import android.app.Activity
import com.apple.android.sdk.authentication.AuthenticationFactory
import com.apple.android.sdk.authentication.AuthenticationManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AppleMusicKitModule : Module() {

    private var pendingPromise: Promise? = null
    private var authManager: AuthenticationManager? = null

    override fun definition() = ModuleDefinition {
        // Aligned with the JS implementation's requireNativeModule parameter
        Name("AppleMusicKit")

        Events("onPlaybackStateChange")

        AsyncFunction("authorize") { developerToken: String, promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.reject("ERR_NO_ACTIVITY", "No foreground activity available", null)
                return@AsyncFunction
            }

            pendingPromise = promise
            authManager = AuthenticationFactory.createAuthenticationManager(activity)

            try {
                val intent = authManager!!.createIntentBuilder(developerToken)
                    .setHideStartScreen(true)
                    .build()

                activity.startActivityForResult(intent, APPLE_MUSIC_REQUEST_CODE)
            } catch (e: Exception) {
                pendingPromise = null
                authManager = null
                promise.reject("ERR_AUTH_LAUNCH", e.message ?: "Failed to launch Apple Music auth", e)
            }
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != APPLE_MUSIC_REQUEST_CODE) return@OnActivityResult

            val promise = pendingPromise
            val manager = authManager

            // Clear state immediately to prevent memory leaks or double-resolutions
            pendingPromise = null
            authManager = null

            if (promise == null || manager == null) return@OnActivityResult

            // Handle the user explicitly canceling the auth flow (e.g. pressing the back button)
            if (payload.resultCode == Activity.RESULT_CANCELED) {
                promise.resolve(mapOf("status" to "canceled", "error" to "User canceled the authentication flow"))
                return@OnActivityResult
            }

            try {
                val result = manager.handleTokenResult(payload.data)

                if (result.isError) {
                    promise.resolve(
                        mapOf(
                            "status" to "failed",
                            "error" to (result.error?.toString() ?: "Unknown error")
                        )
                    )
                } else {
                    promise.resolve(mapOf("status" to "authorized", "userToken" to result.musicUserToken))
                }
            } catch (e: Exception) {
                promise.reject("ERR_AUTH_RESULT", e.message ?: "Failed to process auth result", e)
            }
        }

        AsyncFunction("play") {
            // TODO: Hook up mediaplayback-release player.play()
        }

        AsyncFunction("pause") {
            // TODO: Hook up mediaplayback-release player.pause()
        }

        AsyncFunction("togglePlayerState") {
            // TODO: Hook up state detection
        }

        AsyncFunction("skipToNextEntry") {
            // TODO: Hook up mediaplayback-release skip forward
        }

        AsyncFunction("skipToPreviousEntry") {
            // TODO: Hook up mediaplayback-release skip backward
        }

        AsyncFunction("restartCurrentEntry") {
            // TODO: Hook up mediaplayback-release restart
        }

        AsyncFunction("seekToTime") { time: Double ->
            // TODO: Hook up mediaplayback-release player.seekToPosition()
        }

        AsyncFunction("catalogSearch") { query: String, types: List<String> ->
            // TODO: Native Android catalog network request or fallback implementation
            return@AsyncFunction mapOf<String, Any>()
        }

        AsyncFunction("getTracksFromLibrary") {
            return@AsyncFunction mapOf("items" to listOf<Any>())
        }

        AsyncFunction("getUserPlaylists") { options: Map<String, Int> ->
            return@AsyncFunction mapOf("items" to listOf<Any>())
        }

        AsyncFunction("getLibrarySongs") { options: Map<String, Int> ->
            return@AsyncFunction mapOf("items" to listOf<Any>())
        }

        AsyncFunction("getPlaylistSongs") { playlistId: String ->
            return@AsyncFunction mapOf("items" to listOf<Any>())
        }

        AsyncFunction("setPlaybackQueue") { id: String, type: String ->
            // TODO: Wrap mediaplayback-release playbackQueue logic.
        }
    }

    companion object {
        private const val APPLE_MUSIC_REQUEST_CODE = 0xA550
    }
}
