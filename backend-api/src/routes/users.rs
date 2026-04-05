use crate::auth::SupabaseClaims;
use axum_jwt_auth::Claims;
use sea_orm::sea_query::prelude::DateTime;

pub async fn create(user: Claims<SupabaseClaims>) -> String {
    println!("POST /users/ received");
    println!("\tFound user id: {}", user.claims.user_id);
    println!("\tEmail: {}", user.claims.email);

    let exp = DateTime::from_timestamp_secs(user.claims.expiration as i64).unwrap();

    println!(
        "\t Expires: {} (not timezone adjusted)",
        exp.format("%d/%m/%Y %H:%M")
    );

    format!("User id: {}", user.claims.user_id)
}

pub async fn get_favorite_number() {}

pub async fn set_favorite_number() {}
