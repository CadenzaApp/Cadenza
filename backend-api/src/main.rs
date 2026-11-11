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
use sea_orm::DatabaseConnection;
use std::env;
use std::net::SocketAddr;

use crate::{
    auth::{SupabaseClaims, new_jwt_decoder},
    db::pool::PoolConfig,
    routes::{
        analytics::get_analytics_router, assistant::get_assistant_router,
        events::get_events_router, invites::get_invites_router, listening::get_listening_router,
        live_sessions::get_live_sessions_router, profile::get_profile_router,
        queries::get_queries_router, realtime::get_realtime_router,
        saved_queries::get_saved_queries_router, settings::get_settings_router,
        shared_playlists::get_shared_playlists_router, social::get_social_router,
        songs::get_songs_router, tags::get_tags_router,
    },
    services::{
        assistant::{AssistantService, model::OpenAiAssistantModel},
        default_tags::{BackfillConfig, spawn_default_tag_backfill},
        invite_codes::RedeemLimiter,
        metadata_tags::{MetadataCrawlConfig, MetadataCrawler, spawn_metadata_crawl},
        notification::spawn_notification_cleanup,
        realtime::{InMemoryBus, InMemoryPresence, SharedEventBus, SharedPresence},
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
    assistant_service: AssistantService,
    /// Pushes "this changed" to realtime subscribers. See services::realtime.
    event_bus: SharedEventBus,
    /// Who has the app open. See services::realtime::presence.
    presence: SharedPresence,
    redeem_limiter: RedeemLimiter,
}

#[tokio::main]
async fn main() {
    // load environment variables from .env file, needed for db connections
    dotenv().ok();

    // get a db connection
    let db_url = env::var("DATABASE_URL").expect("error getting DATABASE_URL env var");
    let db = db::pool::connect(&db_url, &PoolConfig::from_env())
        .await
        .expect("error connecting to db");

    // builds a decoder used for parsing JSON Web Tokens into SupabaseClaims structs, which contain auth info like user id and token expiration time.
    let jwt_decoder = new_jwt_decoder().await;

    // init tag generation service
    let tag_gen_service = TagGenerationService::new(OpenAiTagGenerator::new());

    let song_meta_service = SongMetadataService::new();

    // the in-app assistant, on the same OPENAI_API_KEY as tag generation
    let assistant_service = AssistantService::new(OpenAiAssistantModel::new());

    let _ml_service = social_feed::spawn_ml_service();
    let social_feed_service = SocialFeedService::new();

    // a claim a stopped server never settled would hide its song from generation forever
    match db::tags::clear_in_flight_default_tag_generation(&db).await {
        Ok(0) => {}
        Ok(count) => println!("default tags: cleared {count} claims left in flight"),
        Err(err) => eprintln!("default tags: could not clear claims left in flight: {err}"),
    }

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

    // drops notifications older than 30 days. the first pass runs at startup,
    // then once a day. notifications_created_at_idx is the index it walks
    spawn_notification_cleanup(db.clone());

    // ends live sessions left paused, or whose host closed the app, and tells
    // their members
    let event_bus: services::realtime::SharedEventBus = std::sync::Arc::new(InMemoryBus::new());
    services::session_sweep::spawn_session_sweep(db.clone(), event_bus.clone());

    let app_state = AppState {
        db,
        jwt_decoder,
        tag_gen_service,
        song_meta_service,
        metadata_crawler,
        social_feed_service,
        assistant_service,
        event_bus,
        presence: std::sync::Arc::new(InMemoryPresence::new()),
        redeem_limiter: RedeemLimiter::new(),
    };

    // route paths
    let app = Router::new()
        .nest("/tags", get_tags_router())
        .nest("/songs", get_songs_router())
        .nest("/queries", get_queries_router())
        .nest("/saved-queries", get_saved_queries_router())
        .nest("/profile", get_profile_router())
        .nest("/settings", get_settings_router())
        .nest("/social", get_social_router())
        .nest("/events", get_events_router())
        .nest("/analytics", get_analytics_router())
        .nest("/assistant", get_assistant_router())
        .nest("/listening", get_listening_router())
        .nest("/invites", get_invites_router())
        .nest("/shared-playlists", get_shared_playlists_router())
        .nest("/live-sessions", get_live_sessions_router())
        .nest("/realtime", get_realtime_router())
        .route("/test", axum::routing::get(async || "server is reachable"))
        .with_state(app_state)
        .layer(middleware::from_fn(request_log::log_request));

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
