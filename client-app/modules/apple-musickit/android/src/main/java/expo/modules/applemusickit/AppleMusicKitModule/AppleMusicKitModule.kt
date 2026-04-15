package expo.modules.applemusickit.AppleMusicKitModule

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AppleMusicKitModule : Module() {
  override fun definition() = ModuleDefinition {
    // Aligned with the JS implementation's requireNativeModule parameter
    Name("AppleMusicKit")

    Events("onPlaybackStateChange")

    AsyncFunction("authorize") { developerToken: String ->
      // TODO: Wrap musickitauth-release AuthenticationManager.createIntent()
      // and process the result for the Music User Token.
      return@AsyncFunction mapOf("status" to "not_implemented_yet")
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
}
