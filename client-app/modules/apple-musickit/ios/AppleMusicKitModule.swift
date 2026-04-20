import ExpoModulesCore
import Foundation
import MusicKit
import StoreKit

public class AppleMusicKitModule: Module {
    private func artworkURLString(from artwork: Artwork?, width: Int = 200, height: Int = 200) -> String {
        guard let url = artwork?.url(width: width, height: height) else { return "" }

        if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            return url.absoluteString
        }

        guard
            url.scheme?.lowercased() == "musickit",
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let assetPath = components.queryItems?.first(where: { $0.name == "aat" })?.value,
            !assetPath.isEmpty
        else {
            return ""
        }

        let encodedAssetPath = assetPath
            .split(separator: "/")
            .map { segment in
                String(segment).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
                    ?? String(segment)
            }
            .joined(separator: "/")

        return "https://is1-ssl.mzstatic.com/image/thumb/\(encodedAssetPath)/\(width)x\(height)bb.jpg"
    }

    public func definition() -> ModuleDefinition {
        Name("AppleMusicKit")

        Events("onPlaybackStateChange")

        AsyncFunction("authorize") { (developerToken: String) async throws -> [String: String] in
            guard #available(iOS 15.1, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED", description: "Apple MusicKit requires iOS 15.1+.")
            }

            let status = await MusicAuthorization.request()

            switch status {
            case .authorized:
                guard !developerToken.isEmpty else { return ["status": "authorized"] }
                do {
                    let userToken: String = try await withCheckedThrowingContinuation {
                        continuation in
                        SKCloudServiceController().requestUserToken(
                            forDeveloperToken: developerToken
                        ) { token, error in
                            if let error = error {
                                continuation.resume(throwing: error)
                            } else if let token = token {
                                continuation.resume(returning: token)
                            } else {
                                continuation.resume(
                                    throwing: NSError(
                                        domain: "AppleMusicKit", code: -1,
                                        userInfo: [
                                            NSLocalizedDescriptionKey:
                                                "requestUserToken returned neither a token nor an error."
                                        ]))
                            }
                        }
                    }
                    return ["status": "authorized", "userToken": userToken]
                } catch {
                    return ["status": "authorized", "error": error.localizedDescription]
                }
            case .denied: return ["status": "denied"]
            case .restricted: return ["status": "restricted"]
            case .notDetermined: return ["status": "notDetermined"]
            @unknown default: return ["status": "unknown"]
            }
        }

        AsyncFunction("setTokens") { (developerToken: String, userToken: String?) -> Void in
            // No-op: iOS MusicKit frameworks handle the user session automatically.
        }

        AsyncFunction("play") { () async throws -> Void in
            guard #available(iOS 15.0, *) else { return }
            try await ApplicationMusicPlayer.shared.play()
        }

        AsyncFunction("pause") { () -> Void in
            guard #available(iOS 15.0, *) else { return }
            ApplicationMusicPlayer.shared.pause()
        }


        AsyncFunction("togglePlayerState") { () async throws -> Void in
            guard #available(iOS 15.0, *) else { return }
            if ApplicationMusicPlayer.shared.state.playbackStatus == .playing {
                ApplicationMusicPlayer.shared.pause()
            } else {
                try await ApplicationMusicPlayer.shared.play()
            }
        }

        AsyncFunction("skipToNextEntry") { () async throws -> Void in
            guard #available(iOS 15.0, *) else { return }
            try await ApplicationMusicPlayer.shared.skipToNextEntry()
        }

        AsyncFunction("skipToPreviousEntry") { () async throws -> Void in
            guard #available(iOS 15.0, *) else { return }
            try await ApplicationMusicPlayer.shared.skipToPreviousEntry()
        }

        AsyncFunction("restartCurrentEntry") { () -> Void in
            guard #available(iOS 15.0, *) else { return }
            ApplicationMusicPlayer.shared.restartCurrentEntry()
        }

        AsyncFunction("seekToTime") { (time: Double) -> Void in
            guard #available(iOS 15.0, *) else { return }
            ApplicationMusicPlayer.shared.playbackTime = time
        }

        AsyncFunction("catalogSearch") {
            (query: String, types: [String]) async throws -> [String: Any] in
            guard #available(iOS 15.0, *) else {
                throw Exception(name: "ERR_UNSUPPORTED", description: "Requires iOS 15.0+")
            }

            // Map types array to actual MusicKit types if needed, using Song/Album as baseline
            var request = MusicCatalogSearchRequest(term: query, types: [Song.self, Album.self])
            request.limit = 20

            let response = try await request.response()

            // Format to a JSON-friendly dictionary mapping
            let songs = response.songs.map {
                ["id": $0.id.rawValue, "title": $0.title, "artistName": $0.artistName, "artworkUrl": artworkURLString(from: $0.artwork)]
            }
            let albums = response.albums.map {
                ["id": $0.id.rawValue, "title": $0.title, "artistName": $0.artistName, "artworkUrl": artworkURLString(from: $0.artwork)]
            }

            return [
                "songs": songs,
                "albums": albums,
            ]
        }

        AsyncFunction("getTracksFromLibrary") { () async throws -> [String: Any] in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "iOS 16.0+ required to access the user's library.")
            }
            var request = MusicLibraryRequest<Song>()
            request.limit = 50  // Default mapping for recently played/library
            let response = try await request.response()
            let items = response.items.map {
                [
                    "id": $0.id.rawValue,
                    "title": $0.title,
                    "artistName": $0.artistName,
                    "artworkUrl": artworkURLString(from: $0.artwork),
                    "playbackType": "librarySong",
                ]
            }
            return ["items": items]
        }

        AsyncFunction("getUserPlaylists") {
            (options: [String: Int]) async throws -> [String: Any] in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "iOS 16.0+ required to access the user's library.")
            }
            var request = MusicLibraryRequest<Playlist>()
            if let limit = options["limit"] { request.limit = limit }
            let response = try await request.response()
            let items = response.items.map {
                ["id": $0.id.rawValue, "title": $0.name, "artistName": $0.curatorName, "artworkUrl": artworkURLString(from: $0.artwork)]
            }
            return ["items": items]
        }

        AsyncFunction("getLibrarySongs") { (options: [String: Int]) async throws -> [String: Any] in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "iOS 16.0+ required to access the user's library.")
            }
            var request = MusicLibraryRequest<Song>()
            if let limit = options["limit"] { request.limit = limit }
            let response = try await request.response()
            let items = response.items.map {
                [
                    "id": $0.id.rawValue,
                    "title": $0.title,
                    "artistName": $0.artistName,
                    "artworkUrl": artworkURLString(from: $0.artwork),
                    "playbackType": "librarySong",
                ]
            }
            return ["items": items]
        }

        AsyncFunction("getPlaylistSongs") { (playlistId: String) async throws -> [String: Any] in
            // Typically requires a separate network request with `MusicDataRequest` for detailed playlist contents.
            // Stubbed for standard return flow.
            return ["items": []]
        }

        AsyncFunction("setPlaybackQueue") { (id: String, type: String) async throws -> Void in
            guard #available(iOS 15.0, *) else { return }

            // Note: ApplicationMusicPlayer.shared.queue requires fetching the object first.
            if type == "album" {
                var request = MusicCatalogResourceRequest<Album>(
                    matching: \.id, equalTo: MusicItemID(id))
                let response = try await request.response()
                if let album = response.items.first {
                    ApplicationMusicPlayer.shared.queue = [album]
                }
            } else if type == "song" {
                var request = MusicCatalogResourceRequest<Song>(
                    matching: \.id, equalTo: MusicItemID(id))
                let response = try await request.response()
                if let song = response.items.first {
                    ApplicationMusicPlayer.shared.queue = [song]
                }
            } else if type == "librarySong" {
                if #available(iOS 16.0, *) {
                    var request = MusicLibraryRequest<Song>()
                    request.filter(matching: \.id, equalTo: MusicItemID(id))
                    request.limit = 1
                    let response = try await request.response()
                    if let song = response.items.first {
                        ApplicationMusicPlayer.shared.queue = [song]
                    }
                } else {
                    throw Exception(
                        name: "ERR_UNSUPPORTED",
                        description: "iOS 16.0+ required to play library songs.")
                }
            } else if type == "playlist" {
                var request = MusicCatalogResourceRequest<Playlist>(
                    matching: \.id, equalTo: MusicItemID(id))
                let response = try await request.response()
                if let playlist = response.items.first {
                    ApplicationMusicPlayer.shared.queue = [playlist]
                }
            }
        }
    }
}
