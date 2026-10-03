use std::collections::HashMap;
use std::env;
use std::time::Duration;

use dotenvy::dotenv;
use reqwest::{Client, StatusCode, Url};
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::err::CadenzaError;

const APPLE_MUSIC_API_BASE: &str = "https://api.music.apple.com";
const APPLE_MUSIC_HTTP_TIMEOUT_SECS: u64 = 20;

/// Apple caps the `ids` filter at 300 per catalog songs request.
const MAX_IDS_PER_REQUEST: usize = 300;

/// Apple caps the `ids` filter at 100 per catalog albums request.
pub const MAX_ALBUM_IDS_PER_REQUEST: usize = 100;

/// Pages of one album's tracks followed past the first, which already holds 300. No real
/// album gets near this; it stops a `next` link that never ends from looping forever.
const MAX_EXTRA_TRACK_PAGES: usize = 10;

/// Used when `APPLE_MUSIC_STOREFRONT` is unset. Catalog ids and availability differ by
/// storefront, so this is a guess about where the user is.
const DEFAULT_STOREFRONT: &str = "us";

/// Substituted into Apple's `{w}x{h}` artwork url template.
const ARTWORK_SIZE: u32 = 512;

/// What Apple Music knows about one catalog song.
///
/// This is a service type, not a wire type. Callers that need a title fetch it fresh from
/// here. A copy is also kept in `metadata_song_tags_applied` through
/// `services::metadata_tags`, for metadata queries and a song's Metadata Tags only.
#[derive(Debug, Clone, PartialEq)]
pub struct SongMetadata {
    /// The catalog id this was looked up by.
    pub id: String,
    pub title: String,
    pub artist_name: String,
    pub album_name: Option<String>,
    /// The catalog album the song is on. From the song's `albums` relationship, or the album
    /// it was read off when it came from [`SongMetadataService::get_albums_tracks`].
    pub album_id: Option<String>,
    pub duration_ms: Option<u64>,
    /// Already resolved to a real url, not Apple's `{w}x{h}` template.
    pub artwork_url: Option<String>,
    pub genre_names: Vec<String>,
    /// `YYYY-MM-DD`, or just `YYYY` when Apple only knows the year, as Apple sends it.
    pub release_date: Option<String>,
    pub isrc: Option<String>,
    /// `explicit` or `clean`. Absent means Apple gave no rating, which is not the same as
    /// clean.
    pub content_rating: Option<String>,
}

impl SongMetadata {
    /// `"<title> by <artist>"`, the shape `TagGenerator::generate_tags` takes.
    pub fn description(&self) -> String {
        format!("{} by {}", self.title, self.artist_name)
    }
}

// models for the Apple Music catalog songs response, field names match Apple's
// https://developer.apple.com/documentation/applemusicapi/get-multiple-catalog-songs-by-id
#[derive(Deserialize)]
struct CatalogSongsResponse {
    #[serde(default)]
    data: Vec<CatalogSong>,
}
#[derive(Deserialize)]
struct CatalogSong {
    id: String,
    /// `songs` or `music-videos`. An album's tracks hold both.
    #[serde(rename = "type", default)]
    kind: Option<String>,
    /// Absent when Apple returns the resource without attributes, which it does for a
    /// song that exists but is not available in this storefront.
    attributes: Option<CatalogSongAttributes>,
    #[serde(default)]
    relationships: Option<CatalogSongRelationships>,
}
#[derive(Deserialize)]
struct CatalogSongRelationships {
    albums: Option<CatalogRelationship>,
}
/// A relationship as Apple nests it: `{ "data": [{ "id": ... }], "next": ... }`.
#[derive(Deserialize)]
struct CatalogRelationship {
    #[serde(default)]
    data: Vec<CatalogResourceRef>,
}
#[derive(Deserialize)]
struct CatalogResourceRef {
    id: String,
}

// models for the Apple Music catalog albums response
// https://developer.apple.com/documentation/applemusicapi/get-multiple-catalog-albums
#[derive(Deserialize)]
struct CatalogAlbumsResponse {
    #[serde(default)]
    data: Vec<CatalogAlbum>,
}
#[derive(Deserialize)]
struct CatalogAlbum {
    id: String,
    relationships: Option<CatalogAlbumRelationships>,
}
#[derive(Deserialize)]
struct CatalogAlbumRelationships {
    tracks: Option<CatalogTracksPage>,
}
/// One page of an album's tracks. The first page comes inline on the album, later ones
/// from the `next` path, which is relative to [`APPLE_MUSIC_API_BASE`].
#[derive(Deserialize)]
struct CatalogTracksPage {
    #[serde(default)]
    data: Vec<CatalogSong>,
    next: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSongAttributes {
    name: String,
    artist_name: String,
    album_name: Option<String>,
    duration_in_millis: Option<u64>,
    artwork: Option<CatalogArtwork>,
    #[serde(default)]
    genre_names: Vec<String>,
    release_date: Option<String>,
    isrc: Option<String>,
    content_rating: Option<String>,
}
#[derive(Deserialize)]
struct CatalogArtwork {
    url: String,
}

/// Apple ships artwork as a `{w}x{h}` template rather than a usable url.
fn resolve_artwork_url(template: &str) -> String {
    let size = ARTWORK_SIZE.to_string();
    template.replace("{w}", &size).replace("{h}", &size)
}

fn to_song_metadata(song: CatalogSong) -> Option<SongMetadata> {
    let attributes = song.attributes?;
    let album_id = song
        .relationships
        .and_then(|relationships| relationships.albums)
        .and_then(|albums| albums.data.into_iter().next())
        .map(|album| album.id);

    Some(SongMetadata {
        id: song.id,
        title: attributes.name,
        artist_name: attributes.artist_name,
        album_name: attributes.album_name,
        album_id,
        duration_ms: attributes.duration_in_millis,
        artwork_url: attributes.artwork.map(|art| resolve_artwork_url(&art.url)),
        genre_names: attributes.genre_names,
        release_date: attributes.release_date,
        isrc: attributes.isrc,
        content_rating: attributes.content_rating,
    })
}

/// The url for a `next` path Apple handed back. It is a path on the api, like
/// `/v1/catalog/us/albums/1/tracks?offset=300`, so anything else is refused rather than
/// fetched with the developer token attached.
fn next_page_url(next: &str) -> Result<Url, CadenzaError> {
    if !next.starts_with("/v1/") {
        return Err(CadenzaError::SongMetadataErr(format!(
            "apple music returned an unexpected next page: {next}"
        )));
    }
    Url::parse(&format!("{APPLE_MUSIC_API_BASE}{next}"))
        .map_err(|err| CadenzaError::SongMetadataErr(format!("bad apple music url: {}", err)))
}

/// One of an album's tracks, as a song on that album. Music videos are left out, and so is a
/// track with no attributes.
fn to_album_track(album_id: &str, track: CatalogSong) -> Option<SongMetadata> {
    if track.kind.as_deref().is_some_and(|kind| kind != "songs") {
        return None;
    }
    let mut song = to_song_metadata(track)?;
    song.album_id = Some(album_id.to_owned());
    Some(song)
}

/// Reads catalog song metadata from Apple Music with a developer token and no user token.
///
/// Catalog endpoints authenticate with the developer token alone, so this needs no Apple Music
/// account and no `Music-User-Token`. It is therefore catalog only: a song id that exists only
/// in some user's library has no catalog entry to read and comes back as `None`.
#[derive(Clone)]
pub struct SongMetadataService {
    developer_token: String,
    storefront: String,
    http_client: Client,
}

impl SongMetadataService {
    /// Reads `APPLE_MUSIC_DEVELOPER_TOKEN`, and `APPLE_MUSIC_STOREFRONT` if it is set.
    ///
    /// Panics if the token is missing, so a misconfigured deployment fails at construction
    /// rather than on the first lookup.
    pub fn new() -> Self {
        dotenv().ok();

        Self {
            developer_token: env::var("APPLE_MUSIC_DEVELOPER_TOKEN")
                .expect("error getting APPLE_MUSIC_DEVELOPER_TOKEN env var"),
            storefront: env::var("APPLE_MUSIC_STOREFRONT")
                .unwrap_or_else(|_| DEFAULT_STOREFRONT.to_owned()),
            http_client: Client::builder()
                .timeout(Duration::from_secs(APPLE_MUSIC_HTTP_TIMEOUT_SECS))
                .build()
                .expect("failed to build http client for SongMetadataService"),
        }
    }

    /// Looks up every id, keyed by the id it was found under.
    ///
    /// An id Apple knows no catalog song for in this storefront is simply absent from the
    /// map, which covers a library-only id, a bad id, and a song not released there. An
    /// empty input makes no request.
    ///
    /// # Panics
    ///
    /// If `song_ids` is longer than `MAX_IDS_PER_REQUEST`. This is one request and Apple
    /// caps it there, so a longer input is a caller bug, not a runtime condition.
    pub async fn get_songs_metadata(
        &self,
        song_ids: &[String],
    ) -> Result<HashMap<String, SongMetadata>, CadenzaError> {
        assert!(
            song_ids.len() <= MAX_IDS_PER_REQUEST,
            "song metadata lookup takes at most {} ids, got {}",
            MAX_IDS_PER_REQUEST,
            song_ids.len()
        );

        if song_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut url = self.catalog_url("songs")?;

        // query_pairs_mut percent encodes the ids, so an id carrying a reserved character
        // cannot break out of the filter. include=albums is what puts the album id on each
        // song, which the album crawl in services::metadata_tags needs
        url.query_pairs_mut()
            .append_pair("ids", &song_ids.join(","))
            .append_pair("include", "albums");

        let resp_body: CatalogSongsResponse = self.get_json(url).await?;

        let res = resp_body
            .data
            .into_iter()
            .filter_map(to_song_metadata)
            .map(|song| (song.id.clone(), song))
            .collect();

        Ok(res)
    }

    /// Reads every song on each album, keyed by album id.
    ///
    /// Apple puts the first 300 tracks inline on each album, and the rest behind a `next`
    /// path that this follows. Music videos are left out. An album Apple does not return in
    /// this storefront is absent from the map. An empty input makes no request.
    ///
    /// # Panics
    ///
    /// If `album_ids` is longer than [`MAX_ALBUM_IDS_PER_REQUEST`], for the same reason
    /// [`Self::get_songs_metadata`] panics past its cap.
    pub async fn get_albums_tracks(
        &self,
        album_ids: &[String],
    ) -> Result<HashMap<String, Vec<SongMetadata>>, CadenzaError> {
        assert!(
            album_ids.len() <= MAX_ALBUM_IDS_PER_REQUEST,
            "album tracks lookup takes at most {} ids, got {}",
            MAX_ALBUM_IDS_PER_REQUEST,
            album_ids.len()
        );

        if album_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut url = self.catalog_url("albums")?;
        url.query_pairs_mut()
            .append_pair("ids", &album_ids.join(","));

        let resp_body: CatalogAlbumsResponse = self.get_json(url).await?;

        let mut res = HashMap::new();
        for album in resp_body.data {
            let Some(mut page) = album.relationships.and_then(|rel| rel.tracks) else {
                res.insert(album.id, Vec::new());
                continue;
            };

            let mut tracks: Vec<SongMetadata> = Vec::new();
            let mut extra_pages = 0;
            loop {
                tracks.extend(
                    page.data
                        .into_iter()
                        .filter_map(|track| to_album_track(&album.id, track)),
                );
                let Some(next) = page.next else { break };
                if extra_pages == MAX_EXTRA_TRACK_PAGES {
                    break;
                }
                extra_pages += 1;
                page = self.get_json(next_page_url(&next)?).await?;
            }

            res.insert(album.id, tracks);
        }

        Ok(res)
    }

    /// `https://api.music.apple.com/v1/catalog/<storefront>/<resource>`.
    fn catalog_url(&self, resource: &str) -> Result<Url, CadenzaError> {
        Url::parse(&format!(
            "{}/v1/catalog/{}/{}",
            APPLE_MUSIC_API_BASE, self.storefront, resource
        ))
        .map_err(|err| CadenzaError::SongMetadataErr(format!("bad apple music url: {}", err)))
    }

    /// GETs `url` with the developer token and reads the body as `T`.
    ///
    /// A 429 is `SongMetadataRateLimited`, checked before the body, so a caller that runs in
    /// the background can stand down rather than treat it as a plain failure.
    async fn get_json<T: DeserializeOwned>(&self, url: Url) -> Result<T, CadenzaError> {
        let resp = self
            .http_client
            .get(url)
            .header("Authorization", format!("Bearer {}", self.developer_token))
            .send()
            .await
            .map_err(|err| {
                CadenzaError::SongMetadataErr(format!("request to apple music failed: {}", err))
            })?;

        let status = resp.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(CadenzaError::SongMetadataRateLimited);
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(CadenzaError::SongMetadataErr(format!(
                "apple music returned {}: {}",
                status.as_u16(),
                body
            )));
        }

        resp.json::<T>().await.map_err(|err| {
            CadenzaError::SongMetadataErr(format!(
                "apple music returned malformed response: {}",
                err
            ))
        })
    }
}

// ---------------------------------------------------------------------------------------------
// The tests at the bottom call the Apple Music API and need a real developer token in
// APPLE_MUSIC_DEVELOPER_TOKEN. Use `cargo test -- --ignored` to run them.
// Last ran: never
// ---------------------------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    /// the ids a test batch was built from
    fn ids(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| (*id).to_owned()).collect()
    }

    /// a lookup result carrying just enough to tell two songs apart
    fn song(id: &str, title: &str) -> SongMetadata {
        SongMetadata {
            id: id.into(),
            title: title.into(),
            artist_name: "artist".into(),
            album_name: None,
            album_id: None,
            duration_ms: None,
            artwork_url: None,
            genre_names: vec![],
            release_date: None,
            isrc: None,
            content_rating: None,
        }
    }

    /// what one catalog request came back with
    fn found(songs: Vec<SongMetadata>) -> HashMap<String, SongMetadata> {
        songs
            .into_iter()
            .map(|song| (song.id.clone(), song))
            .collect()
    }

    // ----- resolve_artwork_url, no api calls -----

    #[test]
    fn resolve_artwork_url_substitutes_both_dimensions() {
        assert_eq!(
            resolve_artwork_url("https://example.com/a/{w}x{h}bb.jpg"),
            format!(
                "https://example.com/a/{}x{}bb.jpg",
                ARTWORK_SIZE, ARTWORK_SIZE
            )
        );
    }

    #[test]
    fn resolve_artwork_url_leaves_a_url_without_a_template_alone() {
        let url = "https://example.com/a/512x512bb.jpg";
        assert_eq!(resolve_artwork_url(url), url);
    }

    // ----- parsing apple's reply, no api calls -----

    #[test]
    fn parses_the_catalog_songs_shape() {
        let reply = r#"{
            "data": [{
                "id": "1440857781",
                "type": "songs",
                "attributes": {
                    "name": "One",
                    "artistName": "Metallica",
                    "albumName": "...And Justice for All",
                    "durationInMillis": 447260,
                    "genreNames": ["Metal", "Music"],
                    "releaseDate": "1988-08-25",
                    "isrc": "USUM71703326",
                    "artwork": { "url": "https://example.com/{w}x{h}bb.jpg" }
                }
            }]
        }"#;

        let parsed: CatalogSongsResponse = serde_json::from_str(reply).unwrap();
        let songs: Vec<SongMetadata> = parsed
            .data
            .into_iter()
            .filter_map(to_song_metadata)
            .collect();

        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].id, "1440857781");
        assert_eq!(songs[0].title, "One");
        assert_eq!(songs[0].artist_name, "Metallica");
        assert_eq!(songs[0].duration_ms, Some(447260));
        assert_eq!(songs[0].genre_names, ["Metal", "Music"]);
        assert_eq!(songs[0].isrc.as_deref(), Some("USUM71703326"));
        assert_eq!(
            songs[0].artwork_url.as_deref(),
            Some(
                format!(
                    "https://example.com/{}x{}bb.jpg",
                    ARTWORK_SIZE, ARTWORK_SIZE
                )
                .as_str()
            )
        );
    }

    #[test]
    fn drops_a_song_returned_without_attributes() {
        let reply = r#"{"data": [{"id": "123", "type": "songs"}]}"#;

        let parsed: CatalogSongsResponse = serde_json::from_str(reply).unwrap();
        let songs: Vec<SongMetadata> = parsed
            .data
            .into_iter()
            .filter_map(to_song_metadata)
            .collect();

        assert!(songs.is_empty());
    }

    #[test]
    fn parses_a_reply_with_no_data_key() {
        let parsed: CatalogSongsResponse = serde_json::from_str("{}").unwrap();
        assert!(parsed.data.is_empty());
    }

    #[test]
    fn reads_the_album_id_and_content_rating_off_a_song() {
        let reply = r#"{
            "data": [{
                "id": "1",
                "type": "songs",
                "attributes": {
                    "name": "One",
                    "artistName": "Metallica",
                    "contentRating": "explicit",
                    "releaseDate": "1988"
                },
                "relationships": {
                    "albums": { "data": [{ "id": "579372950", "type": "albums" }] }
                }
            }]
        }"#;

        let parsed: CatalogSongsResponse = serde_json::from_str(reply).unwrap();
        let song = to_song_metadata(parsed.data.into_iter().next().unwrap()).unwrap();

        assert_eq!(song.album_id.as_deref(), Some("579372950"));
        assert_eq!(song.content_rating.as_deref(), Some("explicit"));
        assert_eq!(song.release_date.as_deref(), Some("1988"));
    }

    #[test]
    fn a_song_without_an_albums_relationship_has_no_album_id() {
        let reply = r#"{"data": [{"id": "1", "attributes": {"name": "a", "artistName": "b"}}]}"#;

        let parsed: CatalogSongsResponse = serde_json::from_str(reply).unwrap();
        let song = to_song_metadata(parsed.data.into_iter().next().unwrap()).unwrap();

        assert_eq!(song.album_id, None);
        assert_eq!(song.content_rating, None);
    }

    #[test]
    fn album_tracks_are_songs_on_that_album_without_music_videos() {
        let reply = r#"{
            "data": [{
                "id": "10",
                "type": "albums",
                "relationships": {
                    "tracks": {
                        "data": [
                            { "id": "1", "type": "songs", "attributes": { "name": "a", "artistName": "x" } },
                            { "id": "2", "type": "music-videos", "attributes": { "name": "b", "artistName": "x" } },
                            { "id": "3", "type": "songs" }
                        ],
                        "next": "/v1/catalog/us/albums/10/tracks?offset=300"
                    }
                }
            }]
        }"#;

        let parsed: CatalogAlbumsResponse = serde_json::from_str(reply).unwrap();
        let album = parsed.data.into_iter().next().unwrap();
        assert_eq!(album.id, "10");
        let page = album.relationships.unwrap().tracks.unwrap();
        assert_eq!(
            page.next.as_deref(),
            Some("/v1/catalog/us/albums/10/tracks?offset=300")
        );

        let tracks: Vec<SongMetadata> = page
            .data
            .into_iter()
            .filter_map(|track| to_album_track("10", track))
            .collect();

        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].id, "1");
        assert_eq!(tracks[0].album_id.as_deref(), Some("10"));
    }

    #[test]
    fn next_page_url_is_a_path_on_the_api() {
        assert_eq!(
            next_page_url("/v1/catalog/us/albums/10/tracks?offset=300")
                .unwrap()
                .as_str(),
            "https://api.music.apple.com/v1/catalog/us/albums/10/tracks?offset=300"
        );
    }

    #[test]
    fn next_page_url_refuses_anything_but_an_api_path() {
        assert!(next_page_url("https://example.com/steal-the-token").is_err());
        assert!(next_page_url("//example.com/v1/").is_err());
    }

    #[test]
    fn description_is_the_shape_tag_generation_takes() {
        assert_eq!(song("a", "One").description(), "One by artist");
    }

    // ----- the id cap, no api calls -----

    /// a service that can be built without a token, for the checks that never reach the network
    fn offline_service() -> SongMetadataService {
        SongMetadataService {
            developer_token: "test-token".into(),
            storefront: DEFAULT_STOREFRONT.into(),
            http_client: Client::new(),
        }
    }

    #[tokio::test]
    #[should_panic(expected = "takes at most 300 ids")]
    async fn panics_past_the_id_cap() {
        let too_many = vec!["1".to_owned(); MAX_IDS_PER_REQUEST + 1];
        let _ = offline_service().get_songs_metadata(&too_many).await;
    }

    #[tokio::test]
    async fn empty_input_returns_nothing_without_a_request() {
        let res = offline_service().get_songs_metadata(&[]).await.unwrap();
        assert!(res.is_empty());
    }

    #[tokio::test]
    #[should_panic(expected = "takes at most 100 ids")]
    async fn album_tracks_panics_past_the_id_cap() {
        let too_many = vec!["1".to_owned(); MAX_ALBUM_IDS_PER_REQUEST + 1];
        let _ = offline_service().get_albums_tracks(&too_many).await;
    }

    #[tokio::test]
    async fn album_tracks_with_empty_input_makes_no_request() {
        let res = offline_service().get_albums_tracks(&[]).await.unwrap();
        assert!(res.is_empty());
    }

    // ----- these call the api -----

    #[tokio::test]
    #[ignore]
    async fn get_songs_metadata_reads_real_songs() {
        let service = SongMetadataService::new();
        let res = service
            .get_songs_metadata(&ids(&["1440857781", "1613861891"]))
            .await
            .unwrap();

        assert_eq!(res.len(), 2);
        for meta in res.values() {
            assert!(!meta.title.is_empty());
            assert!(!meta.artist_name.is_empty());
        }
        println!("get_songs_metadata_reads_real_songs -- {:?}", res);
    }

    #[tokio::test]
    #[ignore]
    async fn get_songs_metadata_reads_album_ids() {
        let service = SongMetadataService::new();
        let res = service
            .get_songs_metadata(&ids(&["1440857781"]))
            .await
            .unwrap();

        let song = res.get("1440857781").unwrap();
        assert!(song.album_id.is_some(), "{song:?}");
        println!("get_songs_metadata_reads_album_ids -- {:?}", song);
    }

    #[tokio::test]
    #[ignore]
    async fn get_albums_tracks_reads_a_real_album() {
        let service = SongMetadataService::new();
        let song = service
            .get_songs_metadata(&ids(&["1440857781"]))
            .await
            .unwrap()
            .remove("1440857781")
            .unwrap();
        let album_id = song.album_id.unwrap();

        let res = service
            .get_albums_tracks(std::slice::from_ref(&album_id))
            .await
            .unwrap();

        let tracks = res.get(&album_id).unwrap();
        assert!(tracks.iter().any(|track| track.id == "1440857781"));
        assert!(
            tracks
                .iter()
                .all(|track| track.album_id.as_deref() == Some(album_id.as_str()))
        );
        println!(
            "get_albums_tracks_reads_a_real_album -- {} tracks",
            tracks.len()
        );
    }
}
