use std::sync::Arc;

use axum_jwt_auth::RemoteJwksDecoder;
use jsonwebtoken::{Algorithm, Validation};
use serde::{Deserialize, Serialize};

const PROJECT_REF: &str = "zerlyloonvyujsculwde";
const PUBLISHABLE_KEY: &str = "sb_publishable_VlG0XaDpUVGlF03Z84A7-Q_yfn7DSvX";

#[derive(Deserialize, Serialize)]
pub struct SupabaseClaims {
    #[serde(rename = "sub")]
    pub user_id: String,
    #[serde(rename = "exp")]
    // Todo: write some code to help this parse into a DateTime or something like that
    pub expiration: usize,
    pub email: String,
}

pub async fn new_jwt_decoder() -> Arc<RemoteJwksDecoder> {
    let jwks_url = format!(
        "https://{}.supabase.co/auth/v1/.well-known/jwks.json?apikey={}",
        PROJECT_REF, PUBLISHABLE_KEY
    );

    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_audience(&["authenticated"]);

    let decoder: Arc<RemoteJwksDecoder> = Arc::new(
        // Fetch JWT verification keys for this project from supabase. Cached so only happens once on server startup.
        RemoteJwksDecoder::builder()
            .jwks_url(jwks_url)
            .validation(validation)
            .build()
            .expect("Failed to fetch JWKS from Supabase. Check your URL/API Key."),
    );

    let _shutdown_token = decoder
        .initialize()
        .await
        .expect("Failed to fetch initial JWKS from Supabase. Check your network/API key.");
    
    decoder
}
