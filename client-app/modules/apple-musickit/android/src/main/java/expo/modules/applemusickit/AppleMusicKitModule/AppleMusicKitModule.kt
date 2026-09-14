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
import com.apple.android.music.playback.queue.PlaybackQueueInsertionType
import com.apple.android.music.playback.model.MediaContainerType
import com.apple.android.music.playback.model.MediaItemType
import com.apple.android.music.playback.model.PlaybackQueueMoveTargetType
import com.apple.android.music.playback.model.PlaybackRepeatMode
import com.apple.android.music.playback.model.PlaybackShuffleMode
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

    @Volatile
    private var storefrontId: String? = null

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
                Log.e(TAG, "Failed to load native Apple Music libraries.", e)
                return null
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
            // MusicKit's native JavaCPP layer can otherwise reject playback
            // when its default process-memory limits are too conservative.
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
            "catalogId" to (item.subscriptionStoreId ?: ""),
            "resourceKind" to "song",
            "source" to "catalog",
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
        snapshot["shuffleMode"] = when (controller.shuffleMode) {
            PlaybackShuffleMode.SHUFFLE_MODE_SONGS -> "songs"
            else -> "off"
        }
        snapshot["repeatMode"] = when (controller.repeatMode) {
            PlaybackRepeatMode.REPEAT_MODE_ONE -> "one"
            PlaybackRepeatMode.REPEAT_MODE_ALL -> "all"
            else -> "off"
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
            if (pendingPromise != null) {
                promise.reject("ERR_AUTH_IN_PROGRESS", "Apple Music authorization is already in progress", null)
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
            storefrontId = null
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
                // Snapshot polling starts when the root playback provider
                // mounts, potentially before Apple Music tokens are restored.
                // A read must not initialize the token-dependent controller.
                val controller = playerController
                if (controller == null) {
                    promise.resolve(
                        mapOf(
                            "isPlaying" to false,
                            "isLoading" to false,
                            "progress" to 0.0
                        )
                    )
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

        AsyncFunction("setSongPlaybackQueue") {
            ids: List<String>, _types: List<String>, startIndex: Int, promise: Promise ->
            val songIds = ids.toTypedArray()
            if (songIds.isEmpty()) {
                promise.reject("ERR_NOT_FOUND", "No queue songs were supplied", null)
                return@AsyncFunction
            }
            val boundedIndex = startIndex.coerceIn(0, songIds.lastIndex)
            val provider = CatalogPlaybackQueueItemProvider.Builder()
                .items(MediaItemType.SONG, *songIds)
                .startItemIndex(boundedIndex)
                .build()

            Handler(Looper.getMainLooper()).post {
                try {
                    val controller = getOrCreatePlayerController()
                    if (controller == null) {
                        promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                    } else {
                        controller.prepare(provider, true)
                        promise.resolve(null)
                    }
                } catch (e: Exception) {
                    promise.reject("PREPARE_ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("appendSongPlaybackQueue") {
            ids: List<String>, _types: List<String>, promise: Promise ->
            val songIds = ids.toTypedArray()
            if (songIds.isEmpty()) {
                promise.resolve(null)
                return@AsyncFunction
            }
            val provider = CatalogPlaybackQueueItemProvider.Builder()
                .items(MediaItemType.SONG, *songIds)
                .build()

            Handler(Looper.getMainLooper()).post {
                try {
                    val controller = getOrCreatePlayerController()
                    if (controller == null) {
                        promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
                    } else {
                        controller.addQueueItems(
                            provider,
                            PlaybackQueueInsertionType.INSERTION_TYPE_AT_END
                        )
                        promise.resolve(null)
                    }
                } catch (e: Exception) {
                    promise.reject("QUEUE_APPEND_ERROR", e.message, e)
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
                val idsParam = libraryIds.joinToString(",") { encode(it) }
                val response = makeApiRequest("/v1/me/library/songs?ids=$idsParam&include=albums")
                val data = objectList(response["data"])
                fetchedResults.addAll(data.map { formatMediaItem(it) })
            }

            // Fetch Catalog Songs
            if (catalogIds.isNotEmpty()) {
                val idsParam = catalogIds.joinToString(",") { encode(it) }
                val response = makeApiRequest("/v1/catalog/${currentStorefrontId()}/songs?ids=$idsParam&include=albums")
                val data = objectList(response["data"])
                fetchedResults.addAll(data.map { formatMediaItem(it) })
            }

            // Restore original order
            // associateBy creates a Map<String, Map<String, Any>> keyed by the song's "id"
            val resultsMap = mutableMapOf<String, Map<String, Any>>()
            fetchedResults.forEach { result ->
                listOf(result["id"], result["catalogId"], result["libraryId"])
                    .filterIsInstance<String>()
                    .forEach { resultsMap[it] = result }
            }

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

        AsyncFunction("getCollectionFavoriteStatus") { kind: String, id: String ->
            val catalogId = resolveCatalogId(id, kind)
            val encodedId = URLEncoder.encode(catalogId, "UTF-8")
            val response = makeApiRequest("/v1/catalog/${currentStorefrontId()}/$kind/$encodedId?extend=inFavorites")
            val resource = (response["data"] as? List<*>)?.firstOrNull() as? Map<*, *>
            val attributes = resource?.get("attributes") as? Map<*, *>
            return@AsyncFunction mapOf("isFavorite" to (attributes?.get("inFavorites") as? Boolean ?: false))
        }

        AsyncFunction("setCollectionFavoriteStatus") { kind: String, id: String, isFavorite: Boolean ->
            val catalogId = resolveCatalogId(id, kind)
            val encodedId = URLEncoder.encode(catalogId, "UTF-8")
            makeApiRequest(
                "/v1/me/ratings/$kind/$encodedId",
                if (isFavorite) "PUT" else "DELETE",
                if (isFavorite) favoriteRatingBody else null
            )
            return@AsyncFunction mapOf("isFavorite" to isFavorite)
        }

        AsyncFunction("getCollectionInfo") { kind: String, ids: List<String> ->
            if (ids.isEmpty()) return@AsyncFunction emptyList<Map<String, Any>>()

            val libraryIds = ids.filter { it.contains(".") }
            val catalogIds = ids.filter { !it.contains(".") }
            val fetchedResults = mutableListOf<Map<String, Any>>()

            if (libraryIds.isNotEmpty()) {
                val idsParam = libraryIds.joinToString(",") { encode(it) }
                val response = makeApiRequest("/v1/me/library/$kind?ids=$idsParam")
                fetchedResults.addAll(objectList(response["data"]).map { formatMediaItem(it) })
            }

            if (catalogIds.isNotEmpty()) {
                val idsParam = catalogIds.joinToString(",") { encode(it) }
                val response = makeApiRequest("/v1/catalog/${currentStorefrontId()}/$kind?ids=$idsParam")
                fetchedResults.addAll(objectList(response["data"]).map { formatMediaItem(it) })
            }

            val resultsMap = mutableMapOf<String, Map<String, Any>>()
            fetchedResults.forEach { result ->
                listOf(result["id"], result["catalogId"], result["libraryId"])
                    .filterIsInstance<String>()
                    .forEach { resultsMap[it] = result }
            }
            return@AsyncFunction ids.mapNotNull { resultsMap[it] }
        }

        AsyncFunction("catalogSearch") { query: String, types: List<String>, requestedLimit: Int, requestedOffset: Int ->
            val encodedQuery = encode(query)
            val typesStr = types.joinToString(",")
            val options = mapOf(
                "limit" to requestedLimit.coerceIn(1, 25),
                "offset" to requestedOffset.coerceAtLeast(0)
            )
            val response = makeApiRequest(
                "/v1/catalog/${currentStorefrontId()}/search?term=$encodedQuery&types=$typesStr&${pageQuery(options)}"
            )
            val resultsObj = response["results"] as? Map<*, *>
            val songsObj = resultsObj?.get("songs") as? Map<*, *>
            val albumsObj = resultsObj?.get("albums") as? Map<*, *>
            val artistsObj = resultsObj?.get("artists") as? Map<*, *>
            val result = mutableMapOf<String, Any>(
                "songs" to objectList(songsObj?.get("data")).map { formatMediaItem(it) },
                "albums" to objectList(albumsObj?.get("data")).map { formatMediaItem(it) },
                "artists" to objectList(artistsObj?.get("data")).map { formatArtist(it) },
                "hasNextSongs" to !songsObj?.get("next")?.toString().isNullOrBlank(),
                "hasNextAlbums" to !albumsObj?.get("next")?.toString().isNullOrBlank(),
                "hasNextArtists" to !artistsObj?.get("next")?.toString().isNullOrBlank()
            )
            nextOffset(songsObj?.get("next")?.toString())?.let {
                result["nextSongsOffset"] = it
            }
            return@AsyncFunction result
        }

        AsyncFunction("getUserPlaylists") { options: Map<String, Int> ->
            return@AsyncFunction collectionResult(
                makeApiRequest("/v1/me/library/playlists?${pageQuery(options)}")
            )
        }
        AsyncFunction("getLibrarySongs") { options: Map<String, Any?> ->
            val pageOptions = mapOf(
                "limit" to ((options["limit"] as? Number)?.toInt() ?: 50),
                "offset" to ((options["offset"] as? Number)?.toInt() ?: 0)
            )
            return@AsyncFunction collectionResult(
                makeApiRequest("/v1/me/library/songs?${pageQuery(pageOptions)}&include=albums")
            )
        }
        // Same endpoint iOS uses, so both platforms page identically. The
        // payload nests one level deeper than the plain library reads.
        AsyncFunction("searchLibrarySongs") { term: String, options: Map<String, Any?> ->
            val pageOptions = mapOf(
                "limit" to ((options["limit"] as? Number)?.toInt() ?: 50),
                "offset" to ((options["offset"] as? Number)?.toInt() ?: 0)
            )
            val response = makeApiRequest(
                "/v1/me/library/search?term=${encode(term)}&types=library-songs&${pageQuery(pageOptions)}"
            )
            return@AsyncFunction collectionResult(
                librarySearchPage(response, "library-songs")
            )
        }

        AsyncFunction("getPlaylistSongs") { playlistId: String, options: Map<String, Int> ->
            return@AsyncFunction collectionResult(
                makeApiRequest("/v1/me/library/playlists/${encode(playlistId)}/tracks?${pageQuery(options)}&include=albums")
            )
        }
        AsyncFunction("getLibraryAlbums") { options: Map<String, Int> ->
            return@AsyncFunction collectionResult(
                makeApiRequest("/v1/me/library/albums?${pageQuery(options)}")
            )
        }
        // include=catalog so a library artist arrives already carrying the
        // catalog ID the artist screen needs, rather than costing a second
        // request per row before it can be opened.
        AsyncFunction("getLibraryArtists") { options: Map<String, Int> ->
            return@AsyncFunction artistCollectionResult(
                makeApiRequest("/v1/me/library/artists?include=catalog&${pageQuery(options)}")
            )
        }
        // The library search payload nests one level deeper than a plain
        // library read, the same way searchLibrarySongs has to unwrap it.
        AsyncFunction("searchLibraryArtists") { term: String, options: Map<String, Int> ->
            val response = makeApiRequest(
                "/v1/me/library/search?term=${encode(term)}&types=library-artists" +
                    "&include[library-artists]=catalog&${pageQuery(options)}"
            )
            return@AsyncFunction artistCollectionResult(
                librarySearchPage(response, "library-artists")
            )
        }
        AsyncFunction("getRecentlyAdded") { options: Map<String, Int> ->
            // Apple's own recently added feed: albums, playlists, and loose
            // songs in one list, already grouped the way Music groups them.
            return@AsyncFunction collectionResult(
                makeApiRequest("/v1/me/library/recently-added?${pageQuery(options)}")
            )
        }
        AsyncFunction("getAlbumSongs") { albumId: String, options: Map<String, Int> ->
            // Library album ids carry a prefix; a bare one came from the
            // catalog, which is what a song's albumID is, and lives elsewhere.
            val path = if (albumId.contains(".")) {
                "/v1/me/library/albums/${encode(albumId)}/tracks?${pageQuery(options)}&include=albums"
            } else {
                "/v1/catalog/${currentStorefrontId()}/albums/${encode(albumId)}/tracks?${pageQuery(options)}&include=albums"
            }
            return@AsyncFunction collectionResult(makeApiRequest(path))
        }

        AsyncFunction("insertSongsNextInQueue") {
            ids: List<String>, _types: List<String>, promise: Promise ->
            val songIds = ids.toTypedArray()
            if (songIds.isEmpty()) {
                promise.resolve(null)
                return@AsyncFunction
            }
            val provider = CatalogPlaybackQueueItemProvider.Builder()
                .items(MediaItemType.SONG, *songIds)
                .build()

            Handler(Looper.getMainLooper()).post {
                withController(promise) { controller ->
                    controller.addQueueItems(
                        provider,
                        PlaybackQueueInsertionType.INSERTION_TYPE_AFTER_CURRENT_ITEM
                    )
                }
            }
        }

        AsyncFunction("moveQueueItem") { fromIndex: Int, toIndex: Int, promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                withController(promise) { controller ->
                    val items = controller.queueItems
                    if (fromIndex !in items.indices || toIndex !in items.indices ||
                        fromIndex == toIndex
                    ) {
                        return@withController
                    }

                    // The SDK moves relative to another entry rather than to an
                    // index, so which side of the target depends on direction.
                    val target = if (fromIndex < toIndex) {
                        PlaybackQueueMoveTargetType.MOVE_AFTER_TARGET
                    } else {
                        PlaybackQueueMoveTargetType.MOVE_BEFORE_TARGET
                    }
                    controller.moveQueueItemWithId(
                        items[fromIndex].playbackQueueId,
                        items[toIndex].playbackQueueId,
                        target
                    )
                }
            }
        }

        AsyncFunction("removeQueueItem") { index: Int, promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                withController(promise) { controller ->
                    val items = controller.queueItems
                    if (index in items.indices) {
                        controller.removeQueueItemWithId(items[index].playbackQueueId)
                    }
                }
            }
        }

        AsyncFunction("playQueueItem") { index: Int, promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                withController(promise) { controller ->
                    val items = controller.queueItems
                    if (index !in items.indices) return@withController

                    val current = controller.playbackQueueIndex
                    if (index == current) return@withController

                    // Skipping forward drops what was skipped over, which is
                    // what iOS does and what the JS queue mirror expects.
                    if (index > current && current >= 0) {
                        for (position in (current + 1) until index) {
                            controller.removeQueueItemWithId(
                                items[position].playbackQueueId
                            )
                        }
                    }
                    controller.skipToQueueItemWithId(items[index].playbackQueueId)
                }
            }
        }

        AsyncFunction("setShuffleMode") { mode: String, promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                withController(promise) { controller ->
                    if (!controller.canSetShuffleMode()) {
                        throw Exception("Apple Music cannot shuffle this queue.")
                    }
                    controller.setShuffleMode(
                        if (mode == "songs") PlaybackShuffleMode.SHUFFLE_MODE_SONGS
                        else PlaybackShuffleMode.SHUFFLE_MODE_OFF
                    )
                }
            }
        }

        AsyncFunction("setRepeatMode") { mode: String, promise: Promise ->
            Handler(Looper.getMainLooper()).post {
                withController(promise) { controller ->
                    if (!controller.canSetRepeatMode()) {
                        throw Exception("Apple Music cannot repeat this queue.")
                    }
                    controller.setRepeatMode(
                        when (mode) {
                            "one" -> PlaybackRepeatMode.REPEAT_MODE_ONE
                            "all" -> PlaybackRepeatMode.REPEAT_MODE_ALL
                            else -> PlaybackRepeatMode.REPEAT_MODE_OFF
                        }
                    )
                }
            }
        }

        AsyncFunction("addSongsToPlaylist") { playlistId: String, ids: List<String> ->
            val trackData = playlistTrackData(ids)
            if (trackData.isNotEmpty()) {
                makeApiRequest(
                    "/v1/me/library/playlists/${encode(playlistId)}/tracks",
                    "POST",
                    JSONObject(mapOf("data" to JSONArray(trackData))).toString()
                )
            }
            return@AsyncFunction null
        }

        AsyncFunction("createPlaylist") { name: String, ids: List<String> ->
            val payload = JSONObject()
            payload.put("attributes", JSONObject(mapOf("name" to name)))
            val trackData = playlistTrackData(ids)
            if (trackData.isNotEmpty()) {
                payload.put(
                    "relationships",
                    JSONObject(
                        mapOf(
                            "tracks" to JSONObject(
                                mapOf("data" to JSONArray(trackData))
                            )
                        )
                    )
                )
            }

            val response = makeApiRequest(
                "/v1/me/library/playlists", "POST", payload.toString()
            )
            val playlist = objectList(response["data"]).firstOrNull()
                ?: throw Exception("Apple Music did not return the new playlist.")
            return@AsyncFunction formatMediaItem(playlist)
        }

        AsyncFunction("getSongArtists") { songId: String ->
            val catalogId = resolveCatalogSongId(songId)
            val response = makeApiRequest(
                "/v1/catalog/${currentStorefrontId()}/songs/${encode(catalogId)}?include=artists"
            )
            val song = objectList(response["data"]).firstOrNull()
            val relationships = song?.get("relationships") as? Map<*, *>
            val artists = relationships?.get("artists") as? Map<*, *>
            return@AsyncFunction objectList(artists?.get("data")).mapNotNull {
                it["id"]?.toString()
            }
        }

        AsyncFunction("getArtist") { artistId: String ->
            val response = makeApiRequest(
                "/v1/catalog/${currentStorefrontId()}/artists/${encode(artistId)}" +
                    "?views=top-songs,full-albums"
            )
            val artist = objectList(response["data"]).firstOrNull()
                ?: throw Exception("No Apple Music artist with ID $artistId.")
            val attributes = artist["attributes"] as? Map<*, *>
            val views = artist["views"] as? Map<*, *>

            val result = mutableMapOf<String, Any>(
                "id" to (artist["id"]?.toString() ?: artistId),
                "name" to (attributes?.get("name") ?: "Unknown Artist"),
                "topSongs" to viewResources(views?.get("top-songs")),
                "albums" to viewResources(views?.get("full-albums"))
            )
            attributes?.get("genreNames")?.let { result["genres"] = it }
            attributes?.get("url")?.toString()?.takeIf { it.isNotBlank() }?.let {
                result["shareUrl"] = it
            }
            val artwork = attributes?.get("artwork") as? Map<*, *>
            artwork?.get("url")?.toString()?.let {
                // The artist screen runs this full bleed behind its header, so
                // it is asked for at hero size rather than tile size. The small
                // one is what it shows until that arrives.
                result["artworkUrl"] = it.replace("{w}", "1200").replace("{h}", "1200")
                result["artworkUrlSmall"] = it.replace("{w}", "300").replace("{h}", "300")
            }
            artworkColorHex(artwork)?.let { result["artworkColor"] = it }
            return@AsyncFunction result
        }
    }

    /**
     * Runs a queue command against the player, rejecting rather than silently
     * doing nothing when there is no player yet. Every one of these commands
     * has to be posted to the main looper, so they all look the same.
     */
    private fun withController(promise: Promise, body: (MediaPlayerController) -> Unit) {
        val controller = getOrCreatePlayerController()
        if (controller == null) {
            promise.reject("ERR_PLAYER_UNAVAILABLE", "Apple Music player is unavailable", null)
            return
        }
        try {
            body(controller)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_QUEUE_COMMAND", e.message, e)
        }
    }

    /**
     * Playlist writes address catalog songs, so a library-only id has to be
     * resolved first or Apple rejects the whole request.
     */
    private fun playlistTrackData(ids: List<String>): List<JSONObject> =
        ids.map { id ->
            JSONObject(mapOf("id" to resolveCatalogSongId(id), "type" to "songs"))
        }

    private fun viewResources(view: Any?): List<Map<String, Any>> {
        val data = (view as? Map<*, *>)?.get("data")
        return objectList(data).map { formatMediaItem(it) }
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

    /**
     * The same resolution as [resolveCatalogSongId], generalized to any
     * ratable resource type. A purely personal album/playlist never published
     * to the catalog has no catalog ID, so this can legitimately fail for one.
     */
    private fun resolveCatalogId(id: String, resourceKind: String): String {
        if (!id.contains(".")) return id

        val encodedId = URLEncoder.encode(id, "UTF-8")
        val response = makeApiRequest("/v1/me/library/$resourceKind/$encodedId")
        val resource = (response["data"] as? List<*>)?.firstOrNull() as? Map<*, *>
        val attributes = resource?.get("attributes") as? Map<*, *>
        val playParams = attributes?.get("playParams") as? Map<*, *>
        return playParams?.get("catalogId")?.toString()
            ?: throw Exception("No catalog ID is available for library $resourceKind $id.")
    }

    private fun getSongFavoriteStatus(id: String): Map<String, Any> {
        val catalogId = resolveCatalogSongId(id)
        val encodedId = URLEncoder.encode(catalogId, "UTF-8")
        val response = makeApiRequest("/v1/catalog/${currentStorefrontId()}/songs/$encodedId?extend=inFavorites")
        val song = (response["data"] as? List<*>)?.firstOrNull() as? Map<*, *>
        val attributes = song?.get("attributes") as? Map<*, *>
        return mapOf("isFavorite" to (attributes?.get("inFavorites") as? Boolean ?: false))
    }

    private fun currentStorefrontId(): String {
        storefrontId?.let { return it }
        val response = makeApiRequest("/v1/me/storefront")
        val storefront = (response["data"] as? List<*>)
            ?.firstOrNull()
            .let { it as? Map<*, *> }
            ?.get("id")
            ?.toString()
            ?.takeIf { it.isNotBlank() }
            ?: throw Exception("Apple Music did not return a storefront for the current user.")
        storefrontId = storefront
        return storefront
    }

    private fun pageQuery(options: Map<String, Int>): String {
        val limit = (options["limit"] ?: 50).coerceIn(1, 100)
        val offset = (options["offset"] ?: 0).coerceAtLeast(0)
        return "limit=$limit&offset=$offset"
    }

    private fun collectionResult(response: Map<String, Any>): Map<String, Any> {
        val data = objectList(response["data"])
        val result = mutableMapOf<String, Any>(
            "items" to data.map { formatMediaItem(it) },
            "hasNextPage" to !response["next"]?.toString().isNullOrBlank()
        )
        nextOffset(response["next"]?.toString())?.let { result["nextOffset"] = it }
        return result
    }

    /**
     * Unwraps one type's page out of a `/v1/me/library/search` payload, which
     * nests one level deeper than a plain library read.
     */
    private fun librarySearchPage(
        response: Map<String, Any>,
        type: String
    ): Map<String, Any> {
        val results = response["results"] as? Map<*, *>
        return (results?.get(type) as? Map<*, *>)
            ?.entries
            ?.mapNotNull { (key, value) ->
                val stringKey = key as? String ?: return@mapNotNull null
                value?.let { stringKey to it }
            }
            ?.toMap()
            ?: emptyMap()
    }

    /** The artist counterpart to [collectionResult]. Same paging, different rows. */
    private fun artistCollectionResult(response: Map<String, Any>): Map<String, Any> {
        val data = objectList(response["data"])
        val result = mutableMapOf<String, Any>(
            "items" to data.map { formatArtist(it) },
            "hasNextPage" to !response["next"]?.toString().isNullOrBlank()
        )
        nextOffset(response["next"]?.toString())?.let { result["nextOffset"] = it }
        return result
    }

    /**
     * One artist from the API, catalog or library. A library artist carries its
     * catalog equivalent under the `catalog` relationship when Apple knows of
     * one; `id` prefers that catalog ID so the artist screen can open directly.
     */
    private fun formatArtist(item: Map<String, Any>): Map<String, Any> {
        val attributes = item["attributes"] as? Map<*, *> ?: emptyMap<String, Any>()
        val type = (item["type"]?.toString() ?: "artists").lowercase()
        val source = if (type.startsWith("library-")) "library" else "catalog"
        val rawId = item["id"]?.toString() ?: ""

        val relationships = item["relationships"] as? Map<*, *>
        val catalogData = (relationships?.get("catalog") as? Map<*, *>)?.get("data") as? List<*>
        val catalogItem = catalogData?.firstOrNull() as? Map<*, *>
        val catalogId = if (source == "library") catalogItem?.get("id")?.toString() else rawId

        val result = mutableMapOf<String, Any>(
            "id" to (catalogId ?: rawId),
            "name" to (attributes["name"]?.toString() ?: "Unknown Artist"),
            "source" to source
        )
        catalogId?.let { result["catalogId"] = it }
        if (source == "library") result["libraryId"] = rawId

        // Library artists have no artwork of their own; the catalog artist the
        // relationship points at usually does.
        val artworkSource = (catalogItem?.get("attributes") as? Map<*, *>) ?: attributes
        val artwork = artworkSource["artwork"] as? Map<*, *>
        artwork?.get("url")?.toString()?.let {
            result["artworkUrl"] = it.replace("{w}", "200").replace("{h}", "200")
        }
        artworkColorHex(artwork)?.let { result["artworkColor"] = it }
        return result
    }

    /**
     * Apple's own representative color for an artwork, as `#rrggbb`. It ships
     * as a bare hex string under `bgColor`, and library artwork usually has
     * none, in which case the client computes an average itself.
     */
    private fun artworkColorHex(artwork: Map<*, *>?): String? {
        val raw = artwork?.get("bgColor")?.toString() ?: return null
        val trimmed = raw.removePrefix("#")
        if (trimmed.length != 6 && trimmed.length != 8) return null
        return "#" + trimmed.substring(0, 6)
    }

    private fun nextOffset(next: String?): Int? {
        if (next == null) return null
        return next.substringAfter('?', "")
            .split("&")
            .firstOrNull { it.startsWith("offset=") }
            ?.substringAfter("offset=")
            ?.toIntOrNull()
    }

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

    private fun objectList(value: Any?): List<Map<String, Any>> =
        (value as? List<*>)?.mapNotNull { rawValue ->
            val rawMap = rawValue as? Map<*, *> ?: return@mapNotNull null
            rawMap.entries.mapNotNull { (key, entryValue) ->
                val stringKey = key as? String ?: return@mapNotNull null
                entryValue?.let { stringKey to it }
            }.toMap()
        } ?: emptyList()

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
        val type = item["type"]?.toString()?.lowercase() ?: "songs"
        val source = if (type.startsWith("library-")) "library" else "catalog"
        val resourceKind = when {
            type.contains("playlist") -> "playlist"
            type.contains("album") -> "album"
            else -> "song"
        }
        val catalogId = (playParams?.get("catalogId") ?: playParams?.get("globalId"))?.toString()
        val resourceId = item["id"]?.toString() ?: ""
        val playableId = catalogId ?: (item["id"]?.toString() ?: "")
        val playbackType = when (resourceKind) {
            "album" -> "album"
            "playlist" -> "playlist"
            else -> if (source == "library" && catalogId == null) "librarySong" else "song"
        }

        val result = mutableMapOf<String, Any>(
            "id" to playableId,
            "resourceKind" to resourceKind,
            "source" to source,
            "playbackType" to playbackType,
            "title" to (attributes?.get("name") ?: "Unknown Title"),
            "artistName" to (attributes?.get("artistName") ?: attributes?.get("curatorName") ?: "Unknown Artist")
        )
        if (source == "library") result["libraryId"] = resourceId
        if (catalogId != null) result["catalogId"] = catalogId
        else if (source == "catalog") result["catalogId"] = resourceId

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
        artworkColorHex(artworkObj)?.let { result["artworkColor"] = it }

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

        val artistsData = (relationships?.get("artists") as? Map<*, *>)?.get("data") as? List<*>
        val firstArtist = artistsData?.firstOrNull() as? Map<*, *>
        firstArtist?.get("id")?.toString()?.let { result["artistId"] = it }

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
