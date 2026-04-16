package expo.modules.applemusickit.AppleMusicKitModule

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.apple.android.sdk.authentication.AuthenticationFactory
import com.apple.android.sdk.authentication.AuthenticationManager
import com.apple.android.sdk.authentication.TokenProvider
import com.apple.android.music.playback.controller.MediaPlayerController
import com.apple.android.music.playback.controller.MediaPlayerControllerFactory
import com.apple.android.music.playback.queue.CatalogPlaybackQueueItemProvider
import com.apple.android.music.playback.model.MediaContainerType
import com.apple.android.music.playback.model.MediaItemType
import com.apple.android.music.playback.model.PlaybackState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class AppleMusicKitModule : Module() {

    private val TAG = "AppleMusicKit"

    private var pendingPromise: Promise? = null
    private var authManager: AuthenticationManager? = null

    @Volatile
    private var developerToken: String? = null

    @Volatile
    private var userToken: String? = null

    private var playerController: MediaPlayerController? = null
    private var isNativeLoaded = false

    private fun getOrCreatePlayerController(): MediaPlayerController? {
        if (playerController != null) return playerController

        Log.i(TAG, "Initializing MediaPlayerController...")

        val context = appContext.reactContext ?: run {
            Log.e(TAG, "React Context is null!")
            return null
        }

        // LOAD THE NATIVE C++ LIBRARIES BEFORE INITIALIZING THE SDK
        if (!isNativeLoaded) {
            try {
                System.loadLibrary("c++_shared")
                System.loadLibrary("appleMusicSDK")
                isNativeLoaded = true
                Log.i(TAG, "Native C++ libraries loaded successfully.")
            } catch (e: Throwable) {
                Log.e(TAG, "Failed to load native C++ libraries. Playback WILL crash.", e)
            }
        }

        val tokenProvider = object : TokenProvider {
            override fun getDeveloperToken(): String {
                try {
                    val token = this@AppleMusicKitModule.developerToken?.trim() ?: ""
                    if (token.isEmpty()) {
                        Log.w(TAG, "SDK requested Developer Token, but it is empty!")
                    }
                    return token
                } catch (e: Exception) {
                    Log.e(TAG, "Error providing Developer Token", e)
                    return ""
                }
            }

            override fun getUserToken(): String {
                try {
                    val token = this@AppleMusicKitModule.userToken?.trim() ?: ""
                    if (token.isEmpty()) {
                        Log.w(TAG, "SDK requested User Token, but it is empty!")
                    }
                    return token
                } catch (e: Exception) {
                    Log.e(TAG, "Error providing User Token", e)
                    return ""
                }
            }
        }

        try {
            playerController = MediaPlayerControllerFactory.createLocalController(context, tokenProvider)
            Log.i(TAG, "MediaPlayerController successfully created!")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to create player controller", e)
        }

        return playerController
    }

    override fun definition() = ModuleDefinition {
        Name("AppleMusicKit")
        Events("onPlaybackStateChange")

        OnDestroy {
            try {
                playerController?.pause()
                playerController?.javaClass?.getMethod("release")?.invoke(playerController)
            } catch (e: Exception) {
                Log.w(TAG, "Player release skipped or failed during destroy", e)
            } finally {
                playerController = null
            }
        }

        AsyncFunction("authorize") { devToken: String, promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.reject("ERR_NO_ACTIVITY", "No foreground activity available", null)
                return@AsyncFunction
            }
            developerToken = devToken
            pendingPromise = promise
            authManager = AuthenticationFactory.createAuthenticationManager(activity)

            try {
                val intent = authManager!!.createIntentBuilder(devToken)
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
            pendingPromise = null
            authManager = null

            if (promise == null || manager == null) return@OnActivityResult

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
                    userToken = result.musicUserToken
                    Log.i(TAG, "Authorization Successful. User Token length: ${userToken?.length}")
                    promise.resolve(mapOf("status" to "authorized", "userToken" to result.musicUserToken))
                }
            } catch (e: Exception) {
                promise.reject("ERR_AUTH_RESULT", e.message ?: "Failed to process auth result", e)
            }
        }

        AsyncFunction("play") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                getOrCreatePlayerController()?.play()
                promise.resolve(null)
            }
        }

        AsyncFunction("pause") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                getOrCreatePlayerController()?.pause()
                promise.resolve(null)
            }
        }

        AsyncFunction("togglePlayerState") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                val controller = getOrCreatePlayerController()
                if (controller?.playbackState == PlaybackState.PLAYING) {
                    controller.pause()
                } else {
                    controller?.play()
                }
                promise.resolve(null)
            }
        }

        AsyncFunction("skipToNextEntry") { promise: Promise ->
            Handler(Looper.getMainLooper()).post { getOrCreatePlayerController()?.skipToNextItem(); promise.resolve(null) }
        }

        AsyncFunction("skipToPreviousEntry") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                getOrCreatePlayerController()?.skipToPreviousItem(); promise.resolve(
                null
            )
            }
        }

        AsyncFunction("restartCurrentEntry") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                getOrCreatePlayerController()?.seekToPosition(0); promise.resolve(
                null
            )
            }
        }

        AsyncFunction("seekToTime") { time: Double, promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                getOrCreatePlayerController()?.seekToPosition((time * 1000).toLong()); promise.resolve(
                null
            )
            }
        }

        AsyncFunction("setPlaybackQueue") { id: String, type: String, promise: Promise ->
            Log.i(TAG, "Command: setPlaybackQueue(id=$id, type=$type)")

            val builder = CatalogPlaybackQueueItemProvider.Builder()
            when (type.lowercase()) {
                "album" -> builder.containers(MediaContainerType.ALBUM, id)
                "playlist" -> builder.containers(MediaContainerType.PLAYLIST, id)
                "song" -> builder.items(MediaItemType.SONG, id)
                else -> {
                    promise.reject("INVALID_TYPE", "Unsupported queue type: $type", null)
                    return@AsyncFunction
                }
            }
            val provider = builder.build()

            Handler(Looper.getMainLooper()).post {
                try {
                    val controller = getOrCreatePlayerController()
                    Log.i(TAG, "Preparing provider on Main Thread...")
                    controller?.prepare(provider, true)
                    promise.resolve(null)
                } catch (e: Exception) {
                    Log.e(TAG, "Error during prepare()", e)
                    promise.reject("PREPARE_ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getTracksFromLibrary") {
            val response = makeApiRequest("/v1/me/library/songs?limit=50")
            val data = response["data"] as? List<Map<String, Any>> ?: emptyList()
            return@AsyncFunction mapOf("items" to data.map { formatMediaItem(it) })
        }

        AsyncFunction("catalogSearch") { query: String, types: List<String> ->
            val encodedQuery = URLEncoder.encode(query, "UTF-8")
            val typesStr = types.joinToString(",")
            val response = makeApiRequest("/v1/catalog/us/search?term=$encodedQuery&types=$typesStr&limit=20")
            val resultsObj = response["results"] as? Map<*, *>
            val songsObj = resultsObj?.get("songs") as? Map<*, *>
            val albumsObj = resultsObj?.get("albums") as? Map<*, *>
            return@AsyncFunction mapOf(
                "songs" to ((songsObj?.get("data") as? List<Map<String, Any>>)?.map { formatMediaItem(it) }
                    ?: emptyList()),
                "albums" to ((albumsObj?.get("data") as? List<Map<String, Any>>)?.map { formatMediaItem(it) }
                    ?: emptyList())
            )
        }

        AsyncFunction("getUserPlaylists") { options: Map<String, Int> ->
            val limit = options["limit"] ?: 50
            return@AsyncFunction mapOf(
                "items" to (makeApiRequest("/v1/me/library/playlists?limit=$limit")["data"] as? List<Map<String, Any>>
                    ?: emptyList()).map { formatMediaItem(it) })
        }
        AsyncFunction("getLibrarySongs") { options: Map<String, Int> ->
            val limit = options["limit"] ?: 50
            return@AsyncFunction mapOf(
                "items" to (makeApiRequest("/v1/me/library/songs?limit=$limit")["data"] as? List<Map<String, Any>>
                    ?: emptyList()).map { formatMediaItem(it) })
        }
        AsyncFunction("getPlaylistSongs") { playlistId: String ->
            return@AsyncFunction mapOf(
                "items" to (makeApiRequest("/v1/me/library/playlists/$playlistId/tracks")["data"] as? List<Map<String, Any>>
                    ?: emptyList()).map { formatMediaItem(it) })
        }
    }

    private fun makeApiRequest(path: String): Map<String, Any> {
        val devToken = developerToken ?: throw Exception("Missing developerToken. Call authorize first.")
        val url = URL("https://api.music.apple.com$path")
        val connection = url.openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.setRequestProperty("Authorization", "Bearer $devToken")
        userToken?.let { connection.setRequestProperty("Music-User-Token", it) }

        try {
            if (connection.responseCode in 200..299) {
                val jsonString = connection.inputStream.bufferedReader().use { it.readText() }
                return jsonObjectToMap(JSONObject(jsonString))
            } else {
                val errorMsg = connection.errorStream?.bufferedReader()?.use { it.readText() } ?: "Unknown Error"
                Log.e(TAG, "API Error: ${connection.responseCode} - $errorMsg")
                throw Exception("Apple Music API Error (${connection.responseCode}): $errorMsg")
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun formatMediaItem(item: Map<String, Any>): Map<String, Any> {
        val attributes = item["attributes"] as? Map<*, *>
        val playParams = attributes?.get("playParams") as? Map<*, *>

        val catalogId = playParams?.get("catalogId")?.toString()
        val playableId = catalogId ?: (item["id"]?.toString() ?: "")
        val title = attributes?.get("name") ?: "Unknown Title"

        return mapOf(
            "id" to playableId,
            "title" to title,
            "artistName" to (attributes?.get("artistName") ?: "Unknown Artist")
        )
    }

    private fun jsonObjectToMap(jsonObj: JSONObject): Map<String, Any> {
        val map = mutableMapOf<String, Any>()
        val keys = jsonObj.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val value = jsonObj.get(key)
            map[key] = when (value) {
                is JSONObject -> jsonObjectToMap(value)
                is JSONArray -> jsonArrayToList(value)
                else -> value
            }
        }
        return map
    }

    private fun jsonArrayToList(jsonArray: JSONArray): List<Any> {
        val list = mutableListOf<Any>()
        for (i in 0 until jsonArray.length()) {
            val value = jsonArray.get(i)
            list.add(
                when (value) {
                    is JSONObject -> jsonObjectToMap(value)
                    is JSONArray -> jsonArrayToList(value)
                    else -> value
                }
            )
        }
        return list
    }

    companion object {
        private const val APPLE_MUSIC_REQUEST_CODE = 0xA550
    }
}
