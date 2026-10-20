mod auth;
mod db;
mod err;
mod request_log;
mod routes;
mod services;
mod test_utils;

use axum::{Router, extract::FromRef, middleware};

use axum_jwt_auth::Decoder;
use dotenvy::dotenv;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use std::env;
use std::net::SocketAddr;
use std::time::Duration;

use crate::{
    auth::{SupabaseClaims, new_jwt_decoder},
    routes::{
        analytics::get_analytics_router, events::get_events_router, profile::get_profile_router,
        queries::get_queries_router, social::get_social_router, songs::get_songs_router,
        tags::get_tags_router,
    },
    services::{
        default_tags::{BackfillConfig, spawn_default_tag_backfill},
        metadata_tags::{MetadataCrawlConfig, MetadataCrawler, spawn_metadata_crawl},
        social_feed::{self, SocialFeedService},
        song_metadata::SongMetadataService,
        tag_generation::{TagGenerationService, openai_tag_generator::OpenAiTagGenerator},
    },
};

#[derive(Clone, FromRef)]
struct AppState {
    db: DatabaseConnection,
    jwt_decoder: Decoder<SupabaseClaims>,
    tag_gen_service: TagGenerationService,
    song_meta_service: SongMetadataService,
    metadata_crawler: MetadataCrawler,
    social_feed_service: SocialFeedService,
}

/// One shared pool per backend process, independent of the number of app clients.
///
/// Session-mode Supabase connections reserve a slot for each open SQLx connection.
/// Cloning this handle shares the pool; it does not create another one. Idle and
/// lifetime limits retire connections while this process is running, not after
/// a crash. Keep session mode for SQLx's named prepared statements.
fn db_connect_options(db_url: String) -> ConnectOptions {
    let mut options = ConnectOptions::new(db_url);
    options
        .max_connections(MAX_DB_CONNECTIONS)
        .min_connections(0)
        .acquire_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(60))
        .max_lifetime(Duration::from_secs(30 * 60))
        .set_application_name(format!("cadenza-backend-api:{}", std::process::id()))
        .sqlx_logging(false);
    options
}

/// Per-process cap. Other processes and pooler-retained clients use separate slots.
const MAX_DB_CONNECTIONS: u32 = 10;

#[tokio::main]
async fn main() {
    // load environment variables from .env file, needed for db connections
    dotenv().ok();

    // get a db connection
    let db_url = env::var("DATABASE_URL").expect("error getting DATABASE_URL env var");
    let db = Database::connect(db_connect_options(db_url))
        .await
        .expect("error connecting to db");

    println!(
        "[db] pid={} pool_max={} pool_min=0 idle_timeout=60s max_lifetime=1800s",
        std::process::id(),
        MAX_DB_CONNECTIONS
    );

    // builds a decoder used for parsing JSON Web Tokens into SupabaseClaims structs, which contain auth info like user id and token expiration time.
    let jwt_decoder = new_jwt_decoder().await;

    // init tag generation service
    let tag_gen_service = TagGenerationService::new(OpenAiTagGenerator::new());

    let song_meta_service = SongMetadataService::new();

    let _ml_service = social_feed::spawn_ml_service();
    let social_feed_service = SocialFeedService::new();

    // fills in default tags for songs nothing has read yet. off unless the
    // environment turns it on, since every pass can spend Apple Music and
    // OpenAI calls that no request asked for
    match BackfillConfig::from_env() {
        Some(config) => {
            println!(
                "default tag backfill: on, up to {} songs every {}s",
                config.batch_size,
                config.interval.as_secs()
            );
            spawn_default_tag_backfill(
                db.clone(),
                song_meta_service.clone(),
                tag_gen_service.clone(),
                config,
            );
        }
        None => println!("default tag backfill: off"),
    }

    // stores Apple Music metadata for library songs and crawls queued albums, so queries can
    // filter on it. behind METADATA_CRAWL_ENABLED in services::metadata_tags. requests that
    // queue an album wake it through metadata_crawler, so it does not wait for its interval
    let metadata_crawler = MetadataCrawler::new();
    match MetadataCrawlConfig::from_env() {
        Some(config) => {
            println!(
                "metadata crawl: on, up to {} library songs and {} albums a pass, every {}s or when woken",
                config.library_batch_size,
                config.album_batch_size,
                config.interval.as_secs()
            );
            spawn_metadata_crawl(
                db.clone(),
                song_meta_service.clone(),
                config,
                metadata_crawler.clone(),
            );
        }
        None => println!("metadata crawl: off"),
    }

    let log_db = db.clone();
    let app_state = AppState {
        db,
        jwt_decoder,
        tag_gen_service,
        song_meta_service,
        metadata_crawler,
        social_feed_service,
    };

    // route paths
    let app = Router::new()
        .nest("/tags", get_tags_router())
        .nest("/songs", get_songs_router())
        .nest("/queries", get_queries_router())
        .nest("/profile", get_profile_router())
        .nest("/social", get_social_router())
        .nest("/events", get_events_router())
        .nest("/analytics", get_analytics_router())
        .route("/test", axum::routing::get(async || "server is reachable"))
        .with_state(app_state)
        .layer(middleware::from_fn_with_state(
            log_db,
            request_log::log_request,
        ));

    // show time baby
    // Defaults to loopback. Set BIND_ADDR=0.0.0.0:3000 to accept connections
    // from a phone or another machine on the network.
    let addr: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:3000".to_string())
        .parse()
        .expect("BIND_ADDR must look like 0.0.0.0:3000");
    println!("Running on http://{}", addr);

    axum_server::bind(addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

#[cfg(test)]
mod connection_pool_tests {
    use super::*;

    #[tokio::test]
    async fn database_handles_share_one_bounded_pool() {
        // Lazy and min=0: this test must not contact a real database.
        let mut options = db_connect_options("postgres://test:test@localhost/test".to_owned());
        options.connect_lazy(true);
        let db = Database::connect(options).await.expect("lazy pool");
        let pool = db.get_postgres_connection_pool();
        assert_eq!(pool.options().get_max_connections(), MAX_DB_CONNECTIONS);
        assert_eq!(pool.options().get_min_connections(), 0);
        assert_eq!(pool.size(), 0);
        let other_handle = db.clone();
        other_handle.close().await.expect("close shared pool");
        assert!(pool.is_closed(), "cloning must not create another pool");
    }
}
