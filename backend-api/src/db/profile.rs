//! Public profiles: one row per auth user with a unique username and a bio.

use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseConnection, EntityTrait, prelude::Uuid};

use crate::db::entity::profile;
use crate::err::CadenzaError;

/// The most characters a username can have, once trimmed.
const MAX_USERNAME_CHARS: usize = 64;

/// The most characters a bio can have, once trimmed.
const MAX_BIO_CHARS: usize = 500;

/// Returns the profile for `user_id`, or `NotFound` when they have none.
pub async fn get_profile(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<profile::Model, CadenzaError> {
    profile::Entity::find_by_id(user_id)
        .one(db)
        .await?
        .ok_or(CadenzaError::NotFound)
}

/// Creates the user's profile. `username` defaults to the email local part when
/// omitted. `bio` defaults to empty. Fails with `ProfileAlreadyExists` when the
/// user already has a row, or `UsernameAlreadyTaken` when the name is taken.
pub async fn create_profile(
    db: &DatabaseConnection,
    user_id: Uuid,
    email: &str,
    username: Option<&str>,
    bio: Option<&str>,
) -> Result<profile::Model, CadenzaError> {
    let username = match username {
        Some(name) => check_username(name)?.to_owned(),
        None => username_from_email(email),
    };
    let bio = match bio {
        Some(text) => check_bio(text)?.to_owned(),
        None => String::new(),
    };

    let row = profile::ActiveModel {
        uid: Set(user_id),
        username: Set(username),
        bio: Set(bio),
    };

    Ok(row.insert(db).await?)
}

/// Changes the editable fields on the user's profile and returns it. At least
/// one of `username` or `bio` must be set. `NotFound` when they have no row.
pub async fn update_profile(
    db: &DatabaseConnection,
    user_id: Uuid,
    username: Option<&str>,
    bio: Option<&str>,
) -> Result<profile::Model, CadenzaError> {
    if username.is_none() && bio.is_none() {
        return Err(CadenzaError::InvalidRequestBody(
            "set username, bio, or both".to_string(),
        ));
    }

    let Some(existing) = profile::Entity::find_by_id(user_id).one(db).await? else {
        return Err(CadenzaError::NotFound);
    };

    let mut row: profile::ActiveModel = existing.into();
    if let Some(name) = username {
        row.username = Set(check_username(name)?.to_owned());
    }
    if let Some(text) = bio {
        row.bio = Set(check_bio(text)?.to_owned());
    }

    Ok(row.update(db).await?)
}

/// Everything before the first `@` in `email`. An empty local part becomes
/// `"user"`, so a missing or malformed email still makes a usable default.
pub fn username_from_email(email: &str) -> String {
    let local = email.split('@').next().unwrap_or("").trim();
    if local.is_empty() {
        "user".to_owned()
    } else {
        local.to_owned()
    }
}

/// Returns the username trimmed, or a `QueryFormatError` when that leaves it
/// empty, longer than [`MAX_USERNAME_CHARS`], or containing `@`.
fn check_username(username: &str) -> Result<&str, CadenzaError> {
    let username = username.trim();

    if username.is_empty() {
        return Err(CadenzaError::QueryFormatError(
            "a username can't be empty".to_string(),
        ));
    }
    if username.chars().count() > MAX_USERNAME_CHARS {
        return Err(CadenzaError::QueryFormatError(format!(
            "usernames are limited to {MAX_USERNAME_CHARS} characters"
        )));
    }
    if username.contains('@') {
        return Err(CadenzaError::QueryFormatError(
            "a username can't contain '@'".to_string(),
        ));
    }

    Ok(username)
}

/// Returns the bio trimmed, or a `QueryFormatError` when it is longer than
/// [`MAX_BIO_CHARS`]. Empty is allowed.
fn check_bio(bio: &str) -> Result<&str, CadenzaError> {
    let bio = bio.trim();

    if bio.chars().count() > MAX_BIO_CHARS {
        return Err(CadenzaError::QueryFormatError(format!(
            "bios are limited to {MAX_BIO_CHARS} characters"
        )));
    }

    Ok(bio)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::string_of_length;

    #[test]
    fn username_from_email_takes_the_local_part() {
        assert_eq!(username_from_email("sky.escue@gmail.com"), "sky.escue");
        assert_eq!(username_from_email("a@email.com"), "a");
        assert_eq!(username_from_email("no-at-sign"), "no-at-sign");
    }

    #[test]
    fn username_from_email_falls_back_when_the_local_part_is_empty() {
        assert_eq!(username_from_email("@gmail.com"), "user");
        assert_eq!(username_from_email(""), "user");
        assert_eq!(username_from_email("   @x.com"), "user");
    }

    #[test]
    fn check_username_trims_and_rejects_empty_at_and_overlong() {
        assert_eq!(check_username("  alice  ").unwrap(), "alice");
        assert!(check_username(" \n\t ").is_err());
        assert!(check_username("alice@x.com").is_err());

        let longest = "a".repeat(MAX_USERNAME_CHARS);
        assert!(check_username(&longest).is_ok());
        assert!(check_username(&string_of_length(MAX_USERNAME_CHARS + 1)).is_err());
    }

    #[test]
    fn check_bio_allows_empty_and_limits_length_in_characters() {
        assert_eq!(check_bio("  hello \n").unwrap(), "hello");
        assert_eq!(check_bio("   ").unwrap(), "");

        let longest = "\u{e9}".repeat(MAX_BIO_CHARS);
        assert!(check_bio(&format!("  {longest}  ")).is_ok());
        assert!(check_bio(&string_of_length(MAX_BIO_CHARS + 1)).is_err());
    }
}
