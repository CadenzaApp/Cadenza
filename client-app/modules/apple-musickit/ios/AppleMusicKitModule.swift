import ExpoModulesCore
import Foundation
@preconcurrency import MusicKit
import StoreKit

private final class StaticDeveloperTokenProvider: MusicUserTokenProvider,
    MusicDeveloperTokenProvider, @unchecked Sendable
{
    private let token: String

    init(token: String) {
        self.token = token
        super.init()
    }

    func developerToken(options: MusicTokenRequestOptions) async throws -> String {
        token
    }
}

public class AppleMusicKitModule: Module {
    private var developerToken: String?
    private var userToken: String?
    private var storefrontID: String?

    private func makeAPIRequest(
        path: String,
        method: String = "GET",
        body: Data? = nil
    ) async throws -> [String: Any] {
        guard let developerToken, !developerToken.isEmpty else {
            throw Exception(name: "ERR_MISSING_TOKEN", description: "Missing Apple Music developer token.")
        }
        guard let userToken, !userToken.isEmpty else {
            throw Exception(name: "ERR_MISSING_USER_TOKEN", description: "Missing Apple Music user token.")
        }
        guard let url = URL(string: "https://api.music.apple.com\(path)") else {
            throw Exception(name: "ERR_INVALID_URL", description: "Invalid Apple Music API path: \(path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(developerToken)", forHTTPHeaderField: "Authorization")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.setValue(userToken, forHTTPHeaderField: "Music-User-Token")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode)
        else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
            let body = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw Exception(
                name: "ERR_APPLE_MUSIC_API",
                description: "Apple Music API error (\(statusCode)): \(body)")
        }
        guard !data.isEmpty else { return [:] }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw Exception(name: "ERR_INVALID_RESPONSE", description: "Invalid Apple Music API response.")
        }
        return object
    }

    private func resolveCatalogSongID(_ id: String) async throws -> String {
        guard id.hasPrefix("i.") else { return id }

        let encodedID = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let response = try await makeAPIRequest(path: "/v1/me/library/songs/\(encodedID)")
        let song = (response["data"] as? [[String: Any]])?.first
        let attributes = song?["attributes"] as? [String: Any]
        let playParams = attributes?["playParams"] as? [String: Any]
        guard let catalogID = playParams?["catalogId"] as? String else {
            throw Exception(
                name: "ERR_CATALOG_ID_UNAVAILABLE",
                description: "No catalog ID is available for library song \(id).")
        }
        return catalogID
    }

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

    private func formatSong(_ song: Song, playbackType: String) -> [String: Any] {
        let isLibrary = playbackType == "librarySong"
        var dict: [String: Any] = [
            "id": song.id.rawValue,
            "resourceKind": "song",
            "source": isLibrary ? "library" : "catalog",
            "playbackType": playbackType,
            "title": song.title,
            "artistName": song.artistName,
            "artworkUrl": artworkURLString(from: song.artwork, width: 200, height: 200),
            "artworkUrlLarge": artworkURLString(from: song.artwork, width: 1200, height: 1200)
        ]

        if isLibrary {
            dict["libraryId"] = song.id.rawValue
        } else {
            dict["catalogId"] = song.id.rawValue
        }

        if let albumTitle = song.albumTitle {
            dict["albumName"] = albumTitle
        }
        if let duration = song.duration {
            dict["songDuration"] = duration
        }
        if let albumId = song.albums?.first?.id.rawValue {
            dict["albumID"] = albumId
        }
        if !song.genreNames.isEmpty {
            dict["genres"] = song.genreNames
        }
        if let date = song.releaseDate {
            dict["releaseDate"] = date.timeIntervalSince1970 * 1000
        }
        if let url = song.url {
            dict["shareUrl"] = url.absoluteString
        }

        return dict
    }

    private func formatAlbum(_ album: Album) -> [String: Any] {
        [
            "id": album.id.rawValue,
            "catalogId": album.id.rawValue,
            "resourceKind": "album",
            "source": "catalog",
            "playbackType": "album",
            "title": album.title,
            "artistName": album.artistName,
            "artworkUrl": artworkURLString(from: album.artwork),
            "artworkUrlLarge": artworkURLString(from: album.artwork, width: 1200, height: 1200),
        ]
    }

    private func formatPlaylist(_ playlist: Playlist, source: String) -> [String: Any] {
        var result: [String: Any] = [
            "id": playlist.id.rawValue,
            "resourceKind": "playlist",
            "source": source,
            "playbackType": "playlist",
            "title": playlist.name,
            "artworkUrl": artworkURLString(from: playlist.artwork),
            "artworkUrlLarge": artworkURLString(from: playlist.artwork, width: 1200, height: 1200),
        ]
        if source == "library" {
            result["libraryId"] = playlist.id.rawValue
        } else {
            result["catalogId"] = playlist.id.rawValue
        }
        if let curatorName = playlist.curatorName {
            result["artistName"] = curatorName
        }
        return result
    }

    private func formatAPIResource(_ item: [String: Any]) -> [String: Any] {
        let attributes = item["attributes"] as? [String: Any] ?? [:]
        let playParams = attributes["playParams"] as? [String: Any] ?? [:]
        let type = (item["type"] as? String ?? "songs").lowercased()
        let source = type.hasPrefix("library-") ? "library" : "catalog"
        let resourceKind: String
        let playbackType: String
        if type.contains("playlist") {
            resourceKind = "playlist"
            playbackType = "playlist"
        } else if type.contains("album") {
            resourceKind = "album"
            playbackType = "album"
        } else {
            resourceKind = "song"
            playbackType = source == "library" && playParams["catalogId"] == nil
                ? "librarySong" : "song"
        }

        let resourceID = item["id"] as? String ?? ""
        let catalogID = (playParams["catalogId"] ?? playParams["globalId"]) as? String
        let playableID = catalogID ?? resourceID
        var result: [String: Any] = [
            "id": playableID,
            "resourceKind": resourceKind,
            "source": source,
            "playbackType": playbackType,
            "title": attributes["name"] as? String ?? "Unknown Title",
        ]

        if source == "library" {
            result["libraryId"] = resourceID
        }
        if let catalogID {
            result["catalogId"] = catalogID
        } else if source == "catalog" {
            result["catalogId"] = resourceID
        }
        if let artistName = attributes["artistName"] as? String {
            result["artistName"] = artistName
        } else if let curatorName = attributes["curatorName"] as? String {
            result["artistName"] = curatorName
        }
        if let albumName = attributes["albumName"] as? String {
            result["albumName"] = albumName
        }
        if let genres = attributes["genreNames"] as? [String] {
            result["genres"] = genres
        }
        if let shareURL = attributes["url"] as? String, !shareURL.isEmpty {
            result["shareUrl"] = shareURL
        }
        if let duration = attributes["durationInMillis"] as? NSNumber {
            result["songDuration"] = duration.doubleValue / 1000
        }

        if let artwork = attributes["artwork"] as? [String: Any],
           let template = artwork["url"] as? String
        {
            result["artworkUrl"] = artworkURL(template, width: 200, height: 200)
            result["artworkUrlLarge"] = artworkURL(template, width: 1200, height: 1200)
        }

        if let releaseDate = attributes["releaseDate"] as? String,
           let date = Self.releaseDateFormatter.date(from: releaseDate)
        {
            result["releaseDate"] = date.timeIntervalSince1970 * 1000
        }

        let relationships = item["relationships"] as? [String: Any]
        let albums = relationships?["albums"] as? [String: Any]
        let albumData = albums?["data"] as? [[String: Any]]
        if let albumID = albumData?.first?["id"] as? String {
            result["albumID"] = albumID
        }
        return result
    }

    private func artworkURL(_ template: String, width: Int, height: Int) -> String {
        template
            .replacingOccurrences(of: "{w}", with: String(width))
            .replacingOccurrences(of: "{h}", with: String(height))
    }

    private func collectionResult(_ response: [String: Any]) -> [String: Any] {
        let data = response["data"] as? [[String: Any]] ?? []
        var result: [String: Any] = ["items": data.map(formatAPIResource)]
        if let next = response["next"] as? String, !next.isEmpty {
            result["next"] = next
        }
        return result
    }

    private func pageQuery(_ options: [String: Int]) -> String {
        let limit = min(100, max(1, options["limit"] ?? 50))
        let offset = max(0, options["offset"] ?? 0)
        return "limit=\(limit)&offset=\(offset)"
    }

    private func currentStorefrontID() async throws -> String {
        if let storefrontID { return storefrontID }
        let response = try await makeAPIRequest(path: "/v1/me/storefront")
        guard let id = (response["data"] as? [[String: Any]])?.first?["id"] as? String,
              !id.isEmpty
        else {
            throw Exception(
                name: "ERR_STOREFRONT_UNAVAILABLE",
                description: "Apple Music did not return a storefront for the current user.")
        }
        storefrontID = id
        return id
    }

    private static let releaseDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    @available(iOS 15.0, *)
    private func playbackSnapshot() -> [String: Any] {
        let player = ApplicationMusicPlayer.shared
        let rawProgress = player.playbackTime
        var snapshot: [String: Any] = [
            "isPlaying": player.state.playbackStatus == .playing,
            "isLoading": false,
            "progress": rawProgress.isFinite ? max(0, rawProgress) : 0
        ]

        guard let item = player.queue.currentEntry?.item else { return snapshot }

        switch item {
        case .song(let song):
            let playbackType = song.id.rawValue.hasPrefix("i.") ? "librarySong" : "song"
            let track = formatSong(song, playbackType: playbackType)
            snapshot["currentTrack"] = track
            if let duration = song.duration {
                snapshot["duration"] = duration
            }
        case .musicVideo:
            break
        @unknown default:
            break
        }

        return snapshot
    }

    public func definition() -> ModuleDefinition {
        Name("AppleMusicKit")

        AsyncFunction("authorize") { (developerToken: String) async throws -> [String: String] in
            guard #available(iOS 15.1, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED", description: "Apple MusicKit requires iOS 15.1+.")
            }

            self.developerToken = developerToken
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
                    self.userToken = userToken
                    return ["status": "authorized", "userToken": userToken]
                } catch {
                    return ["status": "failed", "error": error.localizedDescription]
                }
            case .denied: return ["status": "denied"]
            case .restricted: return ["status": "restricted"]
            case .notDetermined: return ["status": "notDetermined"]
            @unknown default: return ["status": "unknown"]
            }
        }

        AsyncFunction("setTokens") { (developerToken: String, userToken: String?) -> Void in
            // The default provider only works when the MusicKit App Service is
            // enabled for this bundle ID. Supplying the app's already-configured
            // developer token keeps native catalog requests authenticated even
            // when automatic token generation is unavailable.
            self.developerToken = developerToken
            self.userToken = userToken
            self.storefrontID = nil
            guard !developerToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return
            }
            MusicDataRequest.tokenProvider = StaticDeveloperTokenProvider(token: developerToken)
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

        AsyncFunction("getPlaybackSnapshot") { () -> [String: Any] in
            guard #available(iOS 15.0, *) else {
                return ["isPlaying": false, "isLoading": false, "progress": 0]
            }
            return playbackSnapshot()
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

            let requestedTypes = Set(types.map { $0.lowercased() })
            let searchSongs = requestedTypes.isEmpty || requestedTypes.contains("songs")
            let searchAlbums = requestedTypes.isEmpty || requestedTypes.contains("albums")

            // Passing extra result types can make MusicKit fail while decoding a
            // response the caller did not request. Match the requested types (as
            // Android does) instead of always including albums.
            if searchSongs && !searchAlbums {
                var request = MusicCatalogSearchRequest(term: query, types: [Song.self])
                request.limit = 20
                let response = try await request.response()
                return [
                    "songs": response.songs.map { formatSong($0, playbackType: "song") },
                    "albums": [],
                ]
            }

            if searchAlbums && !searchSongs {
                var request = MusicCatalogSearchRequest(term: query, types: [Album.self])
                request.limit = 20
                let response = try await request.response()
                return [
                    "songs": [],
                    "albums": response.albums.map(formatAlbum),
                ]
            }

            guard searchSongs || searchAlbums else {
                return ["songs": [], "albums": []]
            }

            var request = MusicCatalogSearchRequest(term: query, types: [Song.self, Album.self])
            request.limit = 20
            let response = try await request.response()
            return [
                "songs": response.songs.map { formatSong($0, playbackType: "song") },
                "albums": response.albums.map(formatAlbum),
            ]
        }

        AsyncFunction("getSongInfo") { (ids: [String]) async throws -> [[String: Any]] in
            guard #available(iOS 15.0, *) else {
                throw Exception(name: "ERR_UNSUPPORTED", description: "Requires iOS 15.0+")
            }

            if ids.isEmpty { return [] }

            let libraryIds = ids.filter { $0.hasPrefix("i.") }
            let catalogIds = ids.filter { !$0.hasPrefix("i.") }

            var fetchedResults: [[String: Any]] = []

            // Fetch Library Songs
            if !libraryIds.isEmpty {
                if #available(iOS 16.0, *) {
                    for id in libraryIds {
                        var request = MusicLibraryRequest<Song>()
                        request.filter(matching: \.id, equalTo: MusicItemID(id))
                        let response = try await request.response()
                        if let song = response.items.first {
                            fetchedResults.append(self.formatSong(song, playbackType: "librarySong"))
                        }
                    }
                } else {
                    throw Exception(name: "ERR_UNSUPPORTED", description: "iOS 16.0+ required for library songs.")
                }
            }

            // Fetch Catalog Songs
            if !catalogIds.isEmpty {
                let musicItemIds = catalogIds.map { MusicItemID($0) }
                let request = MusicCatalogResourceRequest<Song>(matching: \.id, memberOf: musicItemIds)
                let response = try await request.response()

                let catalogFormatted = response.items.map { self.formatSong($0, playbackType: "song") }
                fetchedResults.append(contentsOf: catalogFormatted)
            }

            // Restore original order
            var resultsDict: [String: [String: Any]] = [:]
            for result in fetchedResults {
                for key in ["id", "catalogId", "libraryId"] {
                    if let id = result[key] as? String {
                        resultsDict[id] = result
                    }
                }
            }

            // compactMap preserves order of `ids` and filters out any nil values automatically
            return ids.compactMap { resultsDict[$0] }
        }

        AsyncFunction("getSongFavoriteStatus") { (id: String) async throws -> [String: Any] in
            let catalogID = try await self.resolveCatalogSongID(id)
            let storefrontID = try await self.currentStorefrontID()
            let encodedID = catalogID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
                ?? catalogID
            let response = try await self.makeAPIRequest(
                path: "/v1/catalog/\(storefrontID)/songs/\(encodedID)?extend=inFavorites")
            let song = (response["data"] as? [[String: Any]])?.first
            let attributes = song?["attributes"] as? [String: Any]
            return ["isFavorite": attributes?["inFavorites"] as? Bool ?? false]
        }

        AsyncFunction("setSongFavoriteStatus") {
            (id: String, isFavorite: Bool) async throws -> [String: Any] in
            let catalogID = try await self.resolveCatalogSongID(id)
            let encodedID = catalogID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
                ?? catalogID
            let ratingBody = isFavorite
                ? try JSONSerialization.data(withJSONObject: [
                    "type": "rating",
                    "attributes": ["value": 1]
                ])
                : nil
            _ = try await self.makeAPIRequest(
                path: "/v1/me/ratings/songs/\(encodedID)",
                method: isFavorite ? "PUT" : "DELETE",
                body: ratingBody)
            return ["isFavorite": isFavorite]
        }

        AsyncFunction("getUserPlaylists") {
            (options: [String: Int]) async throws -> [String: Any] in
            let response = try await self.makeAPIRequest(
                path: "/v1/me/library/playlists?\(self.pageQuery(options))")
            return self.collectionResult(response)
        }

        AsyncFunction("getLibrarySongs") { (options: [String: Int]) async throws -> [String: Any] in
            let response = try await self.makeAPIRequest(
                path: "/v1/me/library/songs?\(self.pageQuery(options))&include=albums")
            return self.collectionResult(response)
        }

        AsyncFunction("getPlaylistSongs") {
            (playlistId: String, options: [String: Int]) async throws -> [String: Any] in
            let encodedID = playlistId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
                ?? playlistId
            let response = try await self.makeAPIRequest(
                path: "/v1/me/library/playlists/\(encodedID)/tracks?\(self.pageQuery(options))&include=albums")
            return self.collectionResult(response)
        }

        AsyncFunction("setPlaybackQueue") { (id: String, type: String) async throws -> Void in
            guard #available(iOS 15.0, *) else { return }

            if type == "album" {
                let request = MusicCatalogResourceRequest<Album>(
                    matching: \.id, equalTo: MusicItemID(id))
                let response = try await request.response()
                guard let album = response.items.first else {
                    throw Exception(name: "ERR_NOT_FOUND", description: "Album not found: \(id)")
                }
                ApplicationMusicPlayer.shared.queue = [album]
            } else if type == "song" {
                let request = MusicCatalogResourceRequest<Song>(
                    matching: \.id, equalTo: MusicItemID(id))
                let response = try await request.response()
                guard let song = response.items.first else {
                    throw Exception(name: "ERR_NOT_FOUND", description: "Song not found: \(id)")
                }
                ApplicationMusicPlayer.shared.queue = [song]
            } else if type == "librarySong" {
                if #available(iOS 16.0, *) {
                    var request = MusicLibraryRequest<Song>()
                    request.filter(matching: \.id, equalTo: MusicItemID(id))
                    request.limit = 1
                    let response = try await request.response()
                    guard let song = response.items.first else {
                        throw Exception(name: "ERR_NOT_FOUND", description: "Library song not found: \(id)")
                    }
                    ApplicationMusicPlayer.shared.queue = [song]
                } else {
                    throw Exception(
                        name: "ERR_UNSUPPORTED",
                        description: "iOS 16.0+ required to play library songs.")
                }
            } else if type == "playlist" {
                if id.hasPrefix("p."), #available(iOS 16.0, *) {
                    var request = MusicLibraryRequest<Playlist>()
                    request.filter(matching: \.id, equalTo: MusicItemID(id))
                    request.limit = 1
                    let response = try await request.response()
                    guard let playlist = response.items.first else {
                        throw Exception(name: "ERR_NOT_FOUND", description: "Library playlist not found: \(id)")
                    }
                    ApplicationMusicPlayer.shared.queue = [playlist]
                } else {
                    let request = MusicCatalogResourceRequest<Playlist>(
                        matching: \.id, equalTo: MusicItemID(id))
                    let response = try await request.response()
                    guard let playlist = response.items.first else {
                        throw Exception(name: "ERR_NOT_FOUND", description: "Playlist not found: \(id)")
                    }
                    ApplicationMusicPlayer.shared.queue = [playlist]
                }
            } else {
                throw Exception(name: "ERR_INVALID_TYPE", description: "Unsupported queue type: \(type)")
            }
        }
    }
}
