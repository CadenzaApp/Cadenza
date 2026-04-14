package expo.modules.applemusickit

import android.content.Intent
import com.apple.android.sdk.authentication.AuthenticationFactory
import com.apple.android.sdk.authentication.AuthenticationManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AppleMusicKitModule : Module() {

    private var pendingPromise: Promise? = null
    private var authManager: AuthenticationManager? = null

    override fun definition() = ModuleDefinition {
        Name("AppleMusicKit")

        AsyncFunction("authorize") { developerToken: String, promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.reject("ERR_NO_ACTIVITY", "No foreground activity available")
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
                promise.reject("ERR_AUTH_LAUNCH", e.message ?: "Failed to launch Apple Music auth")
            }
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != APPLE_MUSIC_REQUEST_CODE) return@OnActivityResult

            val promise = pendingPromise
            val manager = authManager
            pendingPromise = null
            authManager = null

            if (promise == null || manager == null) return@OnActivityResult

            try {
                val result = manager.handleTokenResult(payload.data)
                if (result.isError) {
                    promise.resolve(mapOf("status" to "failed", "error" to (result.error?.toString() ?: "Unknown error")))
                } else {
                    promise.resolve(mapOf("status" to "authorized", "userToken" to result.musicUserToken))
                }
            } catch (e: Exception) {
                promise.reject("ERR_AUTH_RESULT", e.message ?: "Failed to process auth result")
            }
        }
    }

    companion object {
        private const val APPLE_MUSIC_REQUEST_CODE = 0xA550
    }
}
