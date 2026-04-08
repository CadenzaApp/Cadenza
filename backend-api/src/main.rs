mod auth;
mod db;
mod routes;
mod models;

use axum::{
    Router,
    extract::FromRef,
    routing::{get, post},
};
use axum_jwt_auth::Decoder;
use dotenvy::dotenv;
use sea_orm::{Database, DatabaseConnection};
use std::env;
use std::net::SocketAddr;

use crate::auth::{SupabaseClaims, new_jwt_decoder};

#[derive(Clone, FromRef)]
struct AppState {
    db: DatabaseConnection,
    jwt_decoder: Decoder<SupabaseClaims>,
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

    let app_state = AppState { db, jwt_decoder };

    // route paths
    let app = Router::new()
        .route("/users", post(routes::users::create))
        .route("/tagging", post(routes::tagging::apply_tag_handler))
        .with_state(app_state);

    // show time baby
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Running on http://{}", addr);

    axum_server::bind(addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}
