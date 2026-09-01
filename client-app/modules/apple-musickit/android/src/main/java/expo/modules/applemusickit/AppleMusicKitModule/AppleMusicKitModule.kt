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
import com.apple.android.music.playback.model.PlayerMediaItem
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
    private val favoriteRatingBody = """{"type":"rating","attributes":{"value":1}}"""

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
            // default max jvm memory is sometimes too low and playback fails
            System.setProperty("org.bytedeco.javacpp.maxphysicalbytes", "0")
            System.setProperty("org.bytedeco.javacpp.maxbytes", "0")

            playerController = MediaPlayerControllerFactory.createLocalController(context, tokenProvider)
            Log.i(TAG, "MediaPlayerController successfully created!")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to create player controller", e)
        }

        return playerController
    }

    private fun formatPlayerMediaItem(item: PlayerMediaItem): Map<String, Any> {
        val result = mutableMapOf<String, Any>(
            "id" to (item.subscriptionStoreId ?: ""),
            "playbackType" to "song",
            "title" to (item.title ?: "Unknown Title"),
            "artistName" to (item.artistName ?: "Unknown Artist")
        )

        item.getArtworkUrl(200, 200)?.takeIf { it.isNotBlank() }?.let {
            result["artworkUrl"] = it
        }
        item.getArtworkUrl(1200, 1200)?.takeIf { it.isNotBlank() }?.let {
            result["artworkUrlLarge"] = it
        }
        item.albumTitle?.takeIf { it.isNotBlank() }?.let { result["albumName"] = it }
        item.albumSubscriptionStoreId?.takeIf { it.isNotBlank() }?.let { result["albumID"] = it }
        item.url?.takeIf { it.isNotBlank() }?.let { result["shareUrl"] = it }
        if (item.duration > 0) result["songDuration"] = item.duration / 1000.0

        return result
    }

    private fun playbackSnapshot(controller: MediaPlayerController): Map<String, Any> {
        val progressMs = controller.currentPosition
        val durationMs = controller.duration
        val snapshot = mutableMapOf<String, Any>(
            "isPlaying" to (controller.playbackState == PlaybackState.PLAYING),
            "isLoading" to controller.isBuffering,
            "progress" to if (progressMs >= 0) progressMs / 1000.0 else 0.0
        )

        if (durationMs > 0) snapshot["duration"] = durationMs / 1000.0
        controller.currentItem?.item?.let {
            snapshot["currentTrack"] = formatPlayerMediaItem(it)
        }

        return snapshot
    }

    override fun definition() = ModuleDefinition {
        Name("AppleMusicKit")
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

        AsyncFunction("setTokens") { devToken: String, usrToken: String? ->
            developerToken = devToken
            userToken = usrToken
            Log.i(TAG, "Tokens restored/cleared from JS.")
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
                val controller = getOrCreatePlayerController()
                if (controller == null) {
                    promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                } else {
                    controller.play()
                    promise.resolve(null)
                }
            }
        }

        AsyncFunction("pause") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                val controller = getOrCreatePlayerController()
                if (controller == null) {
                    promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                } else {
                    controller.pause()
                    promise.resolve(null)
                }
            }
        }

        AsyncFunction("togglePlayerState") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                val controller = getOrCreatePlayerController()
                if (controller == null) {
                    promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                } else if (controller.playbackState == PlaybackState.PLAYING) {
                    controller.pause()
                } else {
                    controller.play()
                }
                if (controller != null) promise.resolve(null)
            }
        }

        AsyncFunction("getPlaybackSnapshot") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                val controller = getOrCreatePlayerController()
                if (controller == null) {
                    promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                } else {
                    promise.resolve(playbackSnapshot(controller))
                }
            }
        }

        AsyncFunction("skipToNextEntry") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                val controller = getOrCreatePlayerController()
                if (controller == null) promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                else { controller.skipToNextItem(); promise.resolve(null) }
            }
        }

        AsyncFunction("skipToPreviousEntry") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                val controller = getOrCreatePlayerController()
                if (controller == null) promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                else { controller.skipToPreviousItem(); promise.resolve(null) }
            }
        }

        AsyncFunction("restartCurrentEntry") { promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                val controller = getOrCreatePlayerController()
                if (controller == null) promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                else { controller.seekToPosition(0); promise.resolve(null) }
            }
        }

        AsyncFunction("seekToTime") { time: Double, promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                val controller = getOrCreatePlayerController()
                if (controller == null) promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                else { controller.seekToPosition((time * 1000).toLong()); promise.resolve(null) }
            }
        }

        AsyncFunction("setPlaybackQueue") { id: String, type: String, promise: Promise ->
            Log.i(TAG, "Command: setPlaybackQueue(id=$id, type=$type)")

            val builder = CatalogPlaybackQueueItemProvider.Builder()
            when (type.lowercase()) {
                "album" -> builder.containers(MediaContainerType.ALBUM, id)
                "playlist" -> builder.containers(MediaContainerType.PLAYLIST, id)
                "song", "librarysong" -> builder.items(MediaItemType.SONG, id)
                else -> {
                    promise.reject("INVALID_TYPE", "Unsupported queue type: $type", null)
                    return@AsyncFunction
                }
            }
            val provider = builder.build()

            Handler(Looper.getMainLooper()).post {
                try {
                    val controller = getOrCreatePlayerController()
                    if (controller == null) {
                        promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                        return@post
                    }
                    Log.i(TAG, "Preparing provider on Main Thread...")
                    controller.prepare(provider, true)
                    promise.resolve(null)
                } catch (e: Exception) {
                    Log.e(TAG, "Error during prepare()", e)
                    promise.reject("PREPARE_ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getSongInfo") { ids: List<String> ->
            if (ids.isEmpty()) return@AsyncFunction emptyList<Map<String, Any>>()

            val libraryIds = ids.filter { it.startsWith("i.") }
            val catalogIds = ids.filter { !it.startsWith("i.") }

            val fetchedResults = mutableListOf<Map<String, Any>>()

            // Fetch Library Songs
            if (libraryIds.isNotEmpty()) {
                val idsParam = libraryIds.joinToString(",")
                val response = makeApiRequest("/v1/me/library/songs?ids=$idsParam&include=albums")
                val data = response["data"] as? List<Map<String, Any>> ?: emptyList()
                fetchedResults.addAll(data.map { formatMediaItem(it) })
            }

            // Fetch Catalog Songs
            if (catalogIds.isNotEmpty()) {
                val idsParam = catalogIds.joinToString(",")
                // Hardcoding 'us' storefront for catalog searches to match your existing implementation
                val response = makeApiRequest("/v1/catalog/us/songs?ids=$idsParam&include=albums")
                val data = response["data"] as? List<Map<String, Any>> ?: emptyList()
                fetchedResults.addAll(data.map { formatMediaItem(it) })
            }

            // Restore original order
            // associateBy creates a Map<String, Map<String, Any>> keyed by the song's "id"
            val resultsMap = fetchedResults.associateBy { it["id"] as? String }

            // mapNotNull preserves order of `ids` and filters out nulls
            return@AsyncFunction ids.mapNotNull { resultsMap[it] }
        }

        AsyncFunction("getSongFavoriteStatus") { id: String ->
            return@AsyncFunction getSongFavoriteStatus(id)
        }

        AsyncFunction("setSongFavoriteStatus") { id: String, isFavorite: Boolean ->
            val catalogId = resolveCatalogSongId(id)
            val encodedId = URLEncoder.encode(catalogId, "UTF-8")
            makeApiRequest(
                "/v1/me/ratings/songs/$encodedId",
                if (isFavorite) "PUT" else "DELETE",
                if (isFavorite) favoriteRatingBody else null
            )
            return@AsyncFunction mapOf("isFavorite" to isFavorite)
        }

        AsyncFunction("getTracksFromLibrary") {
            val response = makeApiRequest("/v1/me/library/songs?limit=50&include=albums")
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
                "songs" to ((songsObj?.get("data") as? List<Map<String, Any>>)?.map {
                    formatMediaItem(it)
                }
                    ?: emptyList()),
                "albums" to ((albumsObj?.get("data") as? List<Map<String, Any>>)?.map {
                    formatMediaItem(it)
                }
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
                "items" to (makeApiRequest("/v1/me/library/songs?limit=$limit&include=albums")["data"] as? List<Map<String, Any>>
                    ?: emptyList()).map { formatMediaItem(it) })
        }
        AsyncFunction("getPlaylistSongs") { playlistId: String ->
            return@AsyncFunction mapOf(
                "items" to (makeApiRequest("/v1/me/library/playlists/$playlistId/tracks")["data"] as? List<Map<String, Any>>
                    ?: emptyList()).map { formatMediaItem(it) })
        }
    }

    private fun resolveCatalogSongId(id: String): String {
        if (!id.startsWith("i.")) return id

        val encodedId = URLEncoder.encode(id, "UTF-8")
        val response = makeApiRequest("/v1/me/library/songs/$encodedId")
        val song = (response["data"] as? List<*>)?.firstOrNull() as? Map<*, *>
        val attributes = song?.get("attributes") as? Map<*, *>
        val playParams = attributes?.get("playParams") as? Map<*, *>
        return playParams?.get("catalogId")?.toString()
            ?: throw Exception("No catalog ID is available for library song $id.")
    }

    private fun getSongFavoriteStatus(id: String): Map<String, Any> {
        val catalogId = resolveCatalogSongId(id)
        val encodedId = URLEncoder.encode(catalogId, "UTF-8")
        val response = makeApiRequest("/v1/catalog/us/songs/$encodedId?extend=inFavorites")
        val song = (response["data"] as? List<*>)?.firstOrNull() as? Map<*, *>
        val attributes = song?.get("attributes") as? Map<*, *>
        return mapOf("isFavorite" to (attributes?.get("inFavorites") as? Boolean ?: false))
    }

    private fun makeApiRequest(
        path: String,
        method: String = "GET",
        body: String? = null
    ): Map<String, Any> {
        val devToken = developerToken?.takeIf { it.isNotBlank() }
            ?: throw Exception("Missing developerToken. Call authorize first.")
        val musicUserToken = userToken?.takeIf { it.isNotBlank() }
            ?: throw Exception("Missing Music User Token. Authorize Apple Music first.")
        val url = URL("https://api.music.apple.com$path")
        val connection = url.openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000
        connection.setRequestProperty("Authorization", "Bearer $devToken")
        connection.setRequestProperty("Music-User-Token", musicUserToken)

        try {
            if (body != null) {
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.outputStream.bufferedWriter().use { it.write(body) }
            }

            val responseCode = connection.responseCode
            if (responseCode in 200..299) {
                val jsonString = connection.inputStream.bufferedReader().use { it.readText() }
                if (jsonString.isBlank()) return emptyMap()
                return jsonObjectToMap(JSONObject(jsonString))
            } else {
                val errorMsg = connection.errorStream?.bufferedReader()?.use { it.readText() } ?: "Unknown Error"
                Log.e(TAG, "API Error: $responseCode - $errorMsg")
                throw Exception("Apple Music API Error ($responseCode): $errorMsg")
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

        val result = mutableMapOf<String, Any>(
            "id" to playableId,
            "playbackType" to "song",
            "title" to (attributes?.get("name") ?: "Unknown Title"),
            "artistName" to (attributes?.get("artistName") ?: "Unknown Artist")
        )

        val artworkObj = attributes?.get("artwork") as? Map<*, *>
        val artworkUrlTemplate = artworkObj?.get("url")?.toString()
        result["artworkUrl"] = artworkUrlTemplate
            ?.replace("{w}", "200")
            ?.replace("{h}", "200")
            ?: ""
        result["artworkUrlLarge"] = artworkUrlTemplate
            ?.replace("{w}", "1200")
            ?.replace("{h}", "1200")
            ?: ""

        attributes?.get("albumName")?.let { result["albumName"] = it }
        attributes?.get("genreNames")?.let { result["genres"] = it }
        attributes?.get("url")?.toString()?.takeIf { it.isNotBlank() }?.let {
            result["shareUrl"] = it
        }

        val durationMs = (attributes?.get("durationInMillis") as? Number)?.toDouble()
        if (durationMs != null) {
            result["songDuration"] = durationMs / 1000.0
        }

        val releaseDateStr = attributes?.get("releaseDate")?.toString()
        if (releaseDateStr != null) {
            try {
                val format = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                format.timeZone = java.util.TimeZone.getTimeZone("UTC")
                val date = format.parse(releaseDateStr)
                if (date != null) {
                    result["releaseDate"] = date.time
                }
            } catch (e: Exception) {
                Log.w("AppleMusicKit", "Failed to parse releaseDate: $releaseDateStr")
            }
        }

        val relationships = item["relationships"] as? Map<*, *>
        val albumsData = (relationships?.get("albums") as? Map<*, *>)?.get("data") as? List<*>
        val firstAlbum = albumsData?.firstOrNull() as? Map<*, *>
        val albumId = firstAlbum?.get("id")?.toString()
        if (albumId != null) {
            result["albumID"] = albumId
        }

        return result
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
