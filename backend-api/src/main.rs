mod auth;
mod db;
mod err;
mod routes;
mod services;
mod test_utils;

use axum::{Router, extract::FromRef};

use axum_jwt_auth::Decoder;
use dotenvy::dotenv;
use sea_orm::{Database, DatabaseConnection};
use std::env;
use std::net::SocketAddr;

use crate::{
    auth::{SupabaseClaims, new_jwt_decoder},
    routes::{
        queries::get_queries_router, 
        // tag_generation_route::get_tag_generation_router,
        tags::get_tags_router,
    }, services::tag_generation::{TagGenerationService, TagGenerator, openai_tag_generator::OpenAiTagGenerator},
};

#[derive(Clone, FromRef)]
struct AppState {
    db: DatabaseConnection,
    jwt_decoder: Decoder<SupabaseClaims>,
    tag_gen_service: TagGenerationService<OpenAiTagGenerator>
}

#[tokio::main]
async fn main() {
    // load environment variables from .env file, needed for db connections
    dotenv().ok();

    // get a db connection
    let db_url = env::var("DATABASE_URL").expect("error getting DATABASE_URL env var");
    let db = Database::connect(db_url)
        .await
        .expect("error connecting to db");

    // builds a decoder used for parsing JSON Web Tokens into SupabaseClaims structs, which contain auth info like user id and token expiration time.
    let jwt_decoder = new_jwt_decoder().await;

    // init tag generation service
    let tag_gen_service = TagGenerationService::new();

    let app_state = AppState { db, jwt_decoder, tag_gen_service };

    // route paths
    let app = Router::new()
        .nest("/tags", get_tags_router())
        .nest("/queries", get_queries_router())
        // .nest("/tag-generation", get_tag_generation_router())
        .with_state(app_state);

    // show time baby
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Running on http://{}", addr);

    axum_server::bind(addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}
