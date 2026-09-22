use std::collections::HashMap;
use std::env;
use std::time::Duration;

use dotenvy::dotenv;
use reqwest::{Client, Url};
use serde::Deserialize;

use crate::err::CadenzaError;

const APPLE_MUSIC_API_BASE: &str = "https://api.music.apple.com";
const APPLE_MUSIC_HTTP_TIMEOUT_SECS: u64 = 20;

/// Apple caps the `ids` filter at 300 per catalog request.
const MAX_IDS_PER_REQUEST: usize = 300;

/// Used when `APPLE_MUSIC_STOREFRONT` is unset. Catalog ids and availability differ by
/// storefront, so this is a guess about where the user is.
const DEFAULT_STOREFRONT: &str = "us";

/// Substituted into Apple's `{w}x{h}` artwork url template.
const ARTWORK_SIZE: u32 = 512;

/// What Apple Music knows about one catalog song.
///
/// This is a service type, not a wire type. Nothing here is persisted: Cadenza still stores
/// only the song id, and this is fetched fresh whenever a caller needs a title.
#[derive(Debug, Clone, PartialEq)]
pub struct SongMetadata {
    /// The catalog id this was looked up by.
    pub id: String,
    pub title: String,
    pub artist_name: String,
    pub album_name: Option<String>,
    pub duration_ms: Option<u64>,
    /// Already resolved to a real url, not Apple's `{w}x{h}` template.
    pub artwork_url: Option<String>,
    pub genre_names: Vec<String>,
    /// `YYYY-MM-DD`, as Apple sends it.
    pub release_date: Option<String>,
    pub isrc: Option<String>,
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
    /// Absent when Apple returns the resource without attributes, which it does for a
    /// song that exists but is not available in this storefront.
    attributes: Option<CatalogSongAttributes>,
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

    Some(SongMetadata {
        id: song.id,
        title: attributes.name,
        artist_name: attributes.artist_name,
        album_name: attributes.album_name,
        duration_ms: attributes.duration_in_millis,
        artwork_url: attributes.artwork.map(|art| resolve_artwork_url(&art.url)),
        genre_names: attributes.genre_names,
        release_date: attributes.release_date,
        isrc: attributes.isrc,
    })
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

        let mut url = Url::parse(&format!(
            "{}/v1/catalog/{}/songs",
            APPLE_MUSIC_API_BASE, self.storefront
        ))
        .map_err(|err| CadenzaError::SongMetadataErr(format!("bad apple music url: {}", err)))?;

        // query_pairs_mut percent encodes the ids, so an id carrying a reserved character
        // cannot break out of the filter
        url.query_pairs_mut()
            .append_pair("ids", &song_ids.join(","));

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
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(CadenzaError::SongMetadataErr(format!(
                "apple music returned {}: {}",
                status.as_u16(),
                body
            )));
        }

        let resp_body = resp.json::<CatalogSongsResponse>().await.map_err(|err| {
            CadenzaError::SongMetadataErr(format!(
                "apple music returned malformed response: {}",
                err
            ))
        })?;

        let res = resp_body
            .data
            .into_iter()
            .filter_map(to_song_metadata)
            .map(|song| (song.id.clone(), song))
            .collect();

        Ok(res)
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
            duration_ms: None,
            artwork_url: None,
            genre_names: vec![],
            release_date: None,
            isrc: None,
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
}
