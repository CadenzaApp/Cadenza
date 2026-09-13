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

    private func formatArtist(_ artist: Artist) -> [String: Any] {
        [
            "id": artist.id.rawValue,
            "catalogId": artist.id.rawValue,
            "name": artist.name,
            "source": "catalog",
            "artworkUrl": artworkURLString(from: artist.artwork),
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
        let artists = relationships?["artists"] as? [String: Any]
        let artistData = artists?["data"] as? [[String: Any]]
        if let artistID = artistData?.first?["id"] as? String {
            result["artistId"] = artistID
        }
        return result
    }

    /// One artist from the raw API, catalog or library. A library artist carries
    /// its catalog equivalent under the `catalog` relationship when Apple knows
    /// of one; `id` prefers that catalog ID so callers can open the artist
    /// screen without a second round trip.
    private func formatAPIArtist(_ item: [String: Any]) -> [String: Any] {
        let attributes = item["attributes"] as? [String: Any] ?? [:]
        let type = (item["type"] as? String ?? "artists").lowercased()
        let source = type.hasPrefix("library-") ? "library" : "catalog"
        let rawID = item["id"] as? String ?? ""

        let relationships = item["relationships"] as? [String: Any]
        let catalog = relationships?["catalog"] as? [String: Any]
        let catalogData = catalog?["data"] as? [[String: Any]]
        let catalogID = source == "library"
            ? catalogData?.first?["id"] as? String
            : rawID

        var result: [String: Any] = [
            "id": catalogID ?? rawID,
            "name": attributes["name"] as? String ?? "Unknown Artist",
            "source": source,
        ]
        if let catalogID { result["catalogId"] = catalogID }
        if source == "library" { result["libraryId"] = rawID }

        // Library artists have no artwork of their own. The catalog artist the
        // relationship points at usually does.
        let artworkAttributes = (catalogData?.first?["attributes"] as? [String: Any]) ?? attributes
        if let artwork = artworkAttributes["artwork"] as? [String: Any],
           let template = artwork["url"] as? String
        {
            result["artworkUrl"] = artworkURL(template, width: 200, height: 200)
        }
        return result
    }

    private func artworkURL(_ template: String, width: Int, height: Int) -> String {
        template
            .replacingOccurrences(of: "{w}", with: String(width))
            .replacingOccurrences(of: "{h}", with: String(height))
    }

    /// The `offset` Apple puts on a paging `next` path, when there is one.
    private func nextOffset(from next: String?) -> Int? {
        guard let next,
              let components = URLComponents(string: next),
              let offset = components.queryItems?.first(where: { $0.name == "offset" })?.value
        else { return nil }
        return Int(offset)
    }

    private func collectionResult(_ response: [String: Any]) -> [String: Any] {
        pagedResult(response, format: formatAPIResource)
    }

    /// The artist counterpart to `collectionResult`. Same paging, different rows.
    private func artistCollectionResult(_ response: [String: Any]) -> [String: Any] {
        pagedResult(response, format: formatAPIArtist)
    }

    private func pagedResult(
        _ response: [String: Any],
        format: ([String: Any]) -> [String: Any]
    ) -> [String: Any] {
        let data = response["data"] as? [[String: Any]] ?? []
        let next = response["next"] as? String
        var result: [String: Any] = [
            "items": data.map(format),
            "hasNextPage": !(next?.isEmpty ?? true),
        ]
        if let offset = nextOffset(from: next) {
            result["nextOffset"] = offset
        }
        return result
    }

    private func collectionResult(
        _ response: MusicLibraryResponse<Song>,
        offset: Int
    ) async -> [String: Any] {
        let songs = Array(response.items)
        let libraryIDs = songs.map(\.id.rawValue)
        var formattedByLibraryID: [String: [String: Any]] = [:]

        // Preserve the existing REST representation when possible so playback,
        // catalog identifiers, and already-applied tags remain compatible.
        if !libraryIDs.isEmpty {
            let encodedIDs = libraryIDs
                .map {
                    $0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0
                }
                .joined(separator: ",")

            do {
                let apiResponse = try await makeAPIRequest(
                    path: "/v1/me/library/songs?ids=\(encodedIDs)&include=albums")
                for item in apiResponse["data"] as? [[String: Any]] ?? [] {
                    guard let libraryID = item["id"] as? String else { continue }
                    formattedByLibraryID[libraryID] = formatAPIResource(item)
                }
            } catch {
                // Enrichment is optional: native MusicLibraryRequest data is
                // sufficient to render and play the library page.
                NSLog("AppleMusicKit: library song enrichment failed: %@", error.localizedDescription)
            }
        }

        let items = songs.map { song -> [String: Any] in
            var item = formattedByLibraryID[song.id.rawValue]
                ?? formatSong(song, playbackType: "librarySong")

            // A library row keeps its library identity even when optional REST
            // enrichment resolves a catalog identifier. Playback has its own
            // explicit identifier so hydration success cannot change list keys.
            item["id"] = song.id.rawValue
            item["libraryId"] = song.id.rawValue
            item["source"] = "library"
            if let catalogID = item["catalogId"] as? String {
                item["playbackId"] = catalogID
                item["playbackType"] = "song"
            } else {
                item["playbackId"] = song.id.rawValue
                item["playbackType"] = "librarySong"
            }

            if let libraryAddedDate = song.libraryAddedDate {
                item["libraryAddedDate"] = libraryAddedDate.timeIntervalSince1970 * 1000
            }

            return item
        }

        var result: [String: Any] = [
            "items": items,
            "hasNextPage": response.items.hasNextBatch,
        ]
        if response.items.hasNextBatch {
            result["nextOffset"] = offset + items.count
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
        // Compared rather than named: `MusicPlayer` is ambiguous for type
        // lookup here, so let the compiler infer both mode types.
        let repeatMode: String
        switch player.state.repeatMode {
        case .one: repeatMode = "one"
        case .all: repeatMode = "all"
        default: repeatMode = "off"
        }
        var snapshot: [String: Any] = [
            "isPlaying": player.state.playbackStatus == .playing,
            "isLoading": false,
            "progress": rawProgress.isFinite ? max(0, rawProgress) : 0,
            "shuffleMode": player.state.shuffleMode == .songs ? "songs" : "off",
            "repeatMode": repeatMode
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

    @available(iOS 16.0, *)
    private func songsForQueue(_ ids: [String], types: [String]) async throws -> [Song] {
        let queueItems = ids.enumerated().map { index, id in
            (id: id, type: types.indices.contains(index) ? types[index] : "song")
        }
        let libraryIDs = queueItems.filter { $0.type == "librarySong" }.map(\.id)
        let catalogIDs = queueItems.filter { $0.type != "librarySong" }.map(\.id)
        var songsByID: [String: Song] = [:]

        if !libraryIDs.isEmpty {
            for song in try await librarySongs(libraryIDs) {
                songsByID[song.id.rawValue] = song
            }
        }

        if !catalogIDs.isEmpty {
            let request = MusicCatalogResourceRequest<Song>(
                matching: \.id,
                memberOf: catalogIDs.map { MusicItemID($0) })
            let response = try await request.response()
            for song in response.items { songsByID[song.id.rawValue] = song }
        }

        return ids.compactMap { songsByID[$0] }
    }

    @available(iOS 16.0, *)
    private func librarySongs(_ ids: [String]) async throws -> [Song] {
        var results: [Song] = []
        for batchStart in stride(from: 0, to: ids.count, by: 100) {
            let batchEnd = min(batchStart + 100, ids.count)
            let batchIDs = ids[batchStart..<batchEnd].map { MusicItemID($0) }
            var request = MusicLibraryRequest<Song>()
            request.filter(matching: \.id, memberOf: batchIDs)
            request.limit = batchIDs.count
            let response = try await request.response()
            results.append(contentsOf: response.items)
        }
        return results
    }

    @available(iOS 16.0, *)
    private func formattedLibrarySongs(_ ids: [String]) async throws -> [[String: Any]] {
        try await librarySongs(ids).map {
            formatSong($0, playbackType: "librarySong")
        }
    }

    /// Position of the entry that is playing inside the whole queue, which is
    /// the index space every queue command here takes.
    @available(iOS 16.0, *)
    private func currentQueueIndex() -> Int? {
        let queue = ApplicationMusicPlayer.shared.queue
        guard let current = queue.currentEntry else { return nil }
        return queue.entries.firstIndex(where: { $0.id == current.id })
    }

    @available(iOS 16.0, *)
    private func replaceSongPlaybackQueue(
        ids: [String],
        types: [String],
        startIndex: Int
    ) async throws {
        let songs = try await songsForQueue(ids, types: types)
        guard !songs.isEmpty else {
            throw Exception(name: "ERR_NOT_FOUND", description: "No queue songs were found.")
        }
        // `songsForQueue` drops ids it could not resolve, so `startIndex`, which
        // addresses the caller's list, cannot be used as a position here. Look
        // up the id it points at and find that song in what actually resolved.
        let requestedID = ids.indices.contains(startIndex) ? ids[startIndex] : ids.first
        let startingSong =
            songs.first(where: { $0.id.rawValue == requestedID }) ?? songs[0]
        ApplicationMusicPlayer.shared.queue = ApplicationMusicPlayer.Queue(
            for: songs,
            startingAt: startingSong)
    }

    @available(iOS 16.0, *)
    private func appendSongPlaybackQueue(ids: [String], types: [String]) async throws {
        let songs = try await songsForQueue(ids, types: types)
        if !songs.isEmpty {
            try await ApplicationMusicPlayer.shared.queue.insert(songs, position: .tail)
        }
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
            (query: String, types: [String], requestedLimit: Int, requestedOffset: Int) async throws -> [String: Any] in
            guard #available(iOS 15.0, *) else {
                throw Exception(name: "ERR_UNSUPPORTED", description: "Requires iOS 15.0+")
            }

            let requestedTypes = Set(types.map { $0.lowercased() })
            let limit = min(25, max(1, requestedLimit))
            let offset = max(0, requestedOffset)

            // Passing a result type the caller did not ask for can make MusicKit
            // fail while decoding it, so the request carries exactly the
            // requested types (as Android does) and nothing more. An empty set
            // means an empty result rather than "everything".
            var searchTypes: [any MusicCatalogSearchable.Type] = []
            if requestedTypes.contains("songs") { searchTypes.append(Song.self) }
            if requestedTypes.contains("albums") { searchTypes.append(Album.self) }
            if requestedTypes.contains("artists") { searchTypes.append(Artist.self) }

            var result: [String: Any] = [
                "songs": [],
                "albums": [],
                "artists": [],
                "hasNextSongs": false,
                "hasNextAlbums": false,
                "hasNextArtists": false,
            ]
            guard !searchTypes.isEmpty else { return result }

            var request = MusicCatalogSearchRequest(term: query, types: searchTypes)
            request.limit = limit
            request.offset = offset
            let response = try await request.response()

            if requestedTypes.contains("songs") {
                result["songs"] = response.songs.map { formatSong($0, playbackType: "song") }
                result["hasNextSongs"] = response.songs.hasNextBatch
                if response.songs.hasNextBatch {
                    result["nextSongsOffset"] = offset + response.songs.count
                }
            }
            if requestedTypes.contains("albums") {
                result["albums"] = response.albums.map(formatAlbum)
                result["hasNextAlbums"] = response.albums.hasNextBatch
            }
            if requestedTypes.contains("artists") {
                result["artists"] = response.artists.map(formatArtist)
                result["hasNextArtists"] = response.artists.hasNextBatch
            }
            return result
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
                    fetchedResults.append(
                        contentsOf: try await self.formattedLibrarySongs(libraryIds))
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

        AsyncFunction("getLibraryAlbums") {
            (options: [String: Int]) async throws -> [String: Any] in
            let response = try await self.makeAPIRequest(
                path: "/v1/me/library/albums?\(self.pageQuery(options))")
            return self.collectionResult(response)
        }

        AsyncFunction("getLibraryArtists") {
            (options: [String: Int]) async throws -> [String: Any] in
            // include=catalog so a library artist arrives already carrying the
            // catalog ID the artist screen needs. Without it every row would
            // cost a second request before it could be opened.
            let response = try await self.makeAPIRequest(
                path: "/v1/me/library/artists?include=catalog&\(self.pageQuery(options))")
            return self.artistCollectionResult(response)
        }

        AsyncFunction("searchLibraryArtists") {
            (term: String, options: [String: Int]) async throws -> [String: Any] in
            let encodedTerm = term.addingPercentEncoding(
                withAllowedCharacters: .urlQueryAllowed) ?? term
            let response = try await self.makeAPIRequest(
                path: "/v1/me/library/search?term=\(encodedTerm)&types=library-artists"
                    + "&\(self.pageQuery(options))")
            // The library search payload nests one level deeper than a plain
            // library read, the same way searchLibrarySongs has to unwrap it.
            let results = response["results"] as? [String: Any] ?? [:]
            let artists = results["library-artists"] as? [String: Any] ?? [:]
            return self.artistCollectionResult(artists)
        }

        AsyncFunction("getRecentlyAdded") {
            (options: [String: Int]) async throws -> [String: Any] in
            // Apple's own recently added feed: albums, playlists, and loose
            // songs in one list, already grouped the way Music groups them.
            let response = try await self.makeAPIRequest(
                path: "/v1/me/library/recently-added?\(self.pageQuery(options))")
            return self.collectionResult(response)
        }

        AsyncFunction("getAlbumSongs") {
            (albumId: String, options: [String: Int]) async throws -> [String: Any] in
            let encodedID = albumId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
                ?? albumId
            // Library album IDs are prefixed ("l."); a bare one came from the
            // catalog, which is what a song's albumID is, and lives elsewhere.
            if self.isLibraryIdentifier(albumId) {
                let response = try await self.makeAPIRequest(
                    path: "/v1/me/library/albums/\(encodedID)/tracks?\(self.pageQuery(options))")
                return self.collectionResult(response)
            }

            let storefront = try await self.currentStorefrontID()
            let response = try await self.makeAPIRequest(
                path:
                    "/v1/catalog/\(storefront)/albums/\(encodedID)/tracks?\(self.pageQuery(options))")
            return self.collectionResult(response)
        }

        AsyncFunction("getLibrarySongs") { (options: [String: Any]) async throws -> [String: Any] in
            guard #available(iOS 16.0, *) else {
                throw Exception(name: "ERR_UNSUPPORTED", description: "Library songs require iOS 16.0+")
            }

            let limit = min(100, max(1, options["limit"] as? Int ?? 50))
            let offset = max(0, options["offset"] as? Int ?? 0)
            let sort = options["sort"] as? [String: Any]
            var request = MusicLibraryRequest<Song>()
            request.limit = limit
            request.offset = offset

            if let sortOption = sort?["option"] as? String {
                let ascending = (sort?["direction"] as? String) != "descending"
                switch sortOption {
                case "title":
                    request.sort(by: \.title, ascending: ascending)
                case "artist":
                    request.sort(by: \.artistName, ascending: ascending)
                case "album":
                    request.sort(by: \.albumTitle, ascending: ascending)
                case "dateAdded":
                    request.sort(by: \.libraryAddedDate, ascending: ascending)
                default:
                    break
                }
            }

            let response = try await request.response()
            return await self.collectionResult(response, offset: offset)
        }

        // Apple's library search endpoint rather than MusicLibrarySearchRequest,
        // which takes a limit but no offset and so cannot page. This is the same
        // call Android makes, so both platforms return the same shape.
        AsyncFunction("searchLibrarySongs") {
            (term: String, options: [String: Int]) async throws -> [String: Any] in
            let encodedTerm = term.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
                ?? term
            let response = try await self.makeAPIRequest(
                path: "/v1/me/library/search?term=\(encodedTerm)&types=library-songs&\(self.pageQuery(options))")
            let results = response["results"] as? [String: Any] ?? [:]
            let songs = results["library-songs"] as? [String: Any] ?? [:]
            return self.collectionResult(songs)
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

        AsyncFunction("setSongPlaybackQueue") {
            (ids: [String], types: [String], startIndex: Int) async throws -> Void in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "Song queues require iOS 16.0+.")
            }
            try await self.replaceSongPlaybackQueue(
                ids: ids, types: types, startIndex: startIndex)
        }

        AsyncFunction("appendSongPlaybackQueue") {
            (ids: [String], types: [String]) async throws -> Void in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "Song queues require iOS 16.0+.")
            }
            try await self.appendSongPlaybackQueue(ids: ids, types: types)
        }

        AsyncFunction("insertSongsNextInQueue") {
            (ids: [String], types: [String]) async throws -> Void in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "Song queues require iOS 16.0+.")
            }
            let songs = try await self.songsForQueue(ids, types: types)
            guard !songs.isEmpty else { return }
            try await ApplicationMusicPlayer.shared.queue.insert(
                songs, position: .afterCurrentEntry)
        }

        AsyncFunction("moveQueueItem") { (fromIndex: Int, toIndex: Int) throws -> Void in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "Queue editing requires iOS 16.0+.")
            }
            let player = ApplicationMusicPlayer.shared
            let count = player.queue.entries.count
            guard fromIndex >= 0, fromIndex < count, toIndex >= 0, toIndex < count,
                  fromIndex != toIndex
            else { return }

            let entry = player.queue.entries[fromIndex]
            player.queue.entries.remove(at: fromIndex)
            player.queue.entries.insert(entry, at: toIndex)
        }

        AsyncFunction("removeQueueItem") { (index: Int) throws -> Void in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "Queue editing requires iOS 16.0+.")
            }
            let player = ApplicationMusicPlayer.shared
            guard index >= 0, index < player.queue.entries.count else { return }
            player.queue.entries.remove(at: index)
        }

        AsyncFunction("playQueueItem") { (index: Int) async throws -> Void in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "Queue editing requires iOS 16.0+.")
            }
            let player = ApplicationMusicPlayer.shared
            guard index >= 0, index < player.queue.entries.count,
                  let current = self.currentQueueIndex(), current != index
            else { return }

            if index < current {
                // MusicKit will not move the cursor directly, so walk it back.
                for _ in 0..<(current - index) {
                    try await player.skipToPreviousEntry()
                }
                return
            }

            // Forward is one skip once everything in between is gone, which is
            // also what Apple Music's up-next list does to the songs skipped.
            if index > current + 1 {
                player.queue.entries.removeSubrange((current + 1)..<index)
            }
            try await player.skipToNextEntry()
        }

        AsyncFunction("setShuffleMode") { (mode: String) throws -> Void in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "Shuffle requires iOS 16.0+.")
            }
            ApplicationMusicPlayer.shared.state.shuffleMode =
                mode == "songs" ? .songs : .off
        }

        AsyncFunction("setRepeatMode") { (mode: String) throws -> Void in
            guard #available(iOS 16.0, *) else {
                throw Exception(
                    name: "ERR_UNSUPPORTED",
                    description: "Repeat requires iOS 16.0+.")
            }
            switch mode {
            case "one": ApplicationMusicPlayer.shared.state.repeatMode = .one
            case "all": ApplicationMusicPlayer.shared.state.repeatMode = .all
            // Module-qualified: bare `.none` would resolve to Optional.none.
            default:
                ApplicationMusicPlayer.shared.state.repeatMode =
                    MusicKit.MusicPlayer.RepeatMode.none
            }
        }

        AsyncFunction("addSongsToPlaylist") {
            (playlistId: String, ids: [String]) async throws -> Void in
            let trackData = try await self.playlistTrackData(ids)
            guard !trackData.isEmpty else { return }

            let body = try JSONSerialization.data(withJSONObject: ["data": trackData])
            let encodedID =
                playlistId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
                ?? playlistId
            _ = try await self.makeAPIRequest(
                path: "/v1/me/library/playlists/\(encodedID)/tracks",
                method: "POST",
                body: body)
        }

        AsyncFunction("createPlaylist") {
            (name: String, ids: [String]) async throws -> [String: Any] in
            let trackData = try await self.playlistTrackData(ids)
            var payload: [String: Any] = ["attributes": ["name": name]]
            if !trackData.isEmpty {
                payload["relationships"] = ["tracks": ["data": trackData]]
            }

            let body = try JSONSerialization.data(withJSONObject: payload)
            let response = try await self.makeAPIRequest(
                path: "/v1/me/library/playlists", method: "POST", body: body)
            guard let playlist = (response["data"] as? [[String: Any]])?.first else {
                throw Exception(
                    name: "ERR_APPLE_MUSIC_API",
                    description: "Apple Music did not return the new playlist.")
            }
            return self.formatAPIResource(playlist)
        }

        AsyncFunction("getSongArtists") { (songId: String) async throws -> [String] in
            let catalogID = try await self.resolveCatalogSongID(songId)
            let storefront = try await self.currentStorefrontID()
            let encodedID =
                catalogID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
                ?? catalogID
            let response = try await self.makeAPIRequest(
                path: "/v1/catalog/\(storefront)/songs/\(encodedID)?include=artists")
            let song = (response["data"] as? [[String: Any]])?.first
            let relationships = song?["relationships"] as? [String: Any]
            let artists = relationships?["artists"] as? [String: Any]
            let data = artists?["data"] as? [[String: Any]] ?? []
            return data.compactMap { $0["id"] as? String }
        }

        AsyncFunction("getArtist") { (artistId: String) async throws -> [String: Any] in
            let storefront = try await self.currentStorefrontID()
            let encodedID =
                artistId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
                ?? artistId
            let response = try await self.makeAPIRequest(
                path:
                    "/v1/catalog/\(storefront)/artists/\(encodedID)?views=top-songs,full-albums")
            guard let artist = (response["data"] as? [[String: Any]])?.first else {
                throw Exception(
                    name: "ERR_NOT_FOUND",
                    description: "No Apple Music artist with ID \(artistId).")
            }

            let attributes = artist["attributes"] as? [String: Any] ?? [:]
            let views = artist["views"] as? [String: Any] ?? [:]
            var result: [String: Any] = [
                "id": artist["id"] as? String ?? artistId,
                "name": attributes["name"] as? String ?? "Unknown Artist",
                "topSongs": self.viewResources(views["top-songs"]),
                "albums": self.viewResources(views["full-albums"]),
            ]
            if let genres = attributes["genreNames"] as? [String] {
                result["genres"] = genres
            }
            if let shareURL = attributes["url"] as? String, !shareURL.isEmpty {
                result["shareUrl"] = shareURL
            }
            if let artwork = attributes["artwork"] as? [String: Any],
               let template = artwork["url"] as? String
            {
                result["artworkUrl"] = self.artworkURL(template, width: 600, height: 600)
            }
            return result
        }
    }

    /// Apple prefixes every library identifier. A bare numeric ID is a catalog
    /// one, and the two live at different API paths.
    private func isLibraryIdentifier(_ id: String) -> Bool {
        id.contains(".")
    }

    /// Playlist writes address catalog songs, so a library-only ID has to be
    /// resolved first or Apple rejects the whole request.
    private func playlistTrackData(_ ids: [String]) async throws -> [[String: String]] {
        var trackData: [[String: String]] = []
        for id in ids {
            let catalogID = try await resolveCatalogSongID(id)
            trackData.append(["id": catalogID, "type": "songs"])
        }
        return trackData
    }

    private func viewResources(_ view: Any?) -> [[String: Any]] {
        let data = (view as? [String: Any])?["data"] as? [[String: Any]] ?? []
        return data.map(formatAPIResource)
    }
}
