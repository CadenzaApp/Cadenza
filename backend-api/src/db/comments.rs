use std::collections::HashMap;

use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    prelude::Uuid,
};

use crate::db::entity::comment;
use crate::err::CadenzaError;

/// The most characters a comment can have, once trimmed.
const MAX_COMMENT_CHARS: usize = 2000;

/// Returns every comment on a song, from every user, as top level comments
/// paired with their replies. Top level comments come newest first, and the
/// replies to each come oldest first.
pub async fn get_song_comments(
    db: &DatabaseConnection,
    song_id: &str,
) -> Result<Vec<(comment::Model, Vec<comment::Model>)>, CadenzaError> {
    // replies store their parent's song id too, so one read gets the whole song
    let comments = comment::Entity::find()
        .filter(comment::Column::SongId.eq(song_id))
        .order_by_asc(comment::Column::Id)
        .all(db)
        .await?;

    Ok(into_threads(comments))
}

/// Pairs each top level comment with its replies. Takes comments oldest first,
/// and returns top level comments newest first, with their replies still oldest
/// first. A reply whose parent is not a top level comment in the list, like a
/// reply to a reply, is dropped.
fn into_threads(comments: Vec<comment::Model>) -> Vec<(comment::Model, Vec<comment::Model>)> {
    let (top_level, replies): (Vec<_>, Vec<_>) = comments
        .into_iter()
        .partition(|comment| comment.parent.is_none());

    // the replies to each comment, in the order they were left
    let mut replies_by_parent: HashMap<i64, Vec<comment::Model>> = HashMap::new();
    for reply in replies {
        if let Some(parent) = reply.parent {
            replies_by_parent.entry(parent).or_default().push(reply);
        }
    }

    top_level
        .into_iter()
        .rev()
        .map(|comment| {
            let replies = replies_by_parent.remove(&comment.id).unwrap_or_default();
            (comment, replies)
        })
        .collect()
}

/// Leaves the user's comment on a song and returns it. With a `parent_id`, the
/// comment is a reply to that comment, which has to be a top level comment on
/// the same song, so replies stay one level deep.
///
/// The content is trimmed first (see [`check_content`]). A parent that doesn't
/// exist is `NotFound`, and one that is a reply or is on another song is a
/// `QueryFormatError`.
pub async fn new_comment(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_id: String,
    parent_id: Option<i64>,
    content: &str,
) -> Result<comment::Model, CadenzaError> {
    let content = check_content(content)?;

    // a reply goes on a top level comment of the same song
    if let Some(parent_id) = parent_id {
        let Some(parent) = comment::Entity::find_by_id(parent_id).one(db).await? else {
            return Err(CadenzaError::NotFound);
        };
        if parent.parent.is_some() {
            return Err(CadenzaError::QueryFormatError(
                "can only reply to a top level comment".to_string(),
            ));
        }
        if parent.song_id.as_deref() != Some(song_id.as_str()) {
            return Err(CadenzaError::QueryFormatError(
                "can only reply to a comment on the same song".to_string(),
            ));
        }
    }

    // the parent can still be deleted before this insert. err.rs maps the
    // foreign key violation that causes to NotFound
    let row = comment::ActiveModel {
        id: NotSet,
        created_at: NotSet,
        parent: Set(parent_id),
        content: Set(content.to_owned()),
        song_id: Set(Some(song_id)),
        user_id: Set(user_id),
    };

    Ok(row.insert(db).await?)
}

/// Returns the content with its surrounding whitespace trimmed, or a
/// `QueryFormatError` if that leaves it empty or longer than
/// [`MAX_COMMENT_CHARS`] characters.
fn check_content(content: &str) -> Result<&str, CadenzaError> {
    let content = content.trim();

    if content.is_empty() {
        return Err(CadenzaError::QueryFormatError(
            "a comment can't be empty".to_string(),
        ));
    }
    if content.chars().count() > MAX_COMMENT_CHARS {
        return Err(CadenzaError::QueryFormatError(format!(
            "comments are limited to {MAX_COMMENT_CHARS} characters"
        )));
    }

    Ok(content)
}

/// Deletes one of the user's comments, and through the cascade every reply to
/// it, whoever left them. `NotFound` if the user has no comment with that id.
pub async fn delete_user_comment(
    db: &DatabaseConnection,
    user_id: Uuid,
    comment_id: i64,
) -> Result<(), CadenzaError> {
    let deleted = comment::Entity::delete_many()
        .filter(comment::Column::Id.eq(comment_id))
        .filter(comment::Column::UserId.eq(user_id))
        .exec(db)
        .await?;

    if deleted.rows_affected == 0 {
        return Err(CadenzaError::NotFound);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::prelude::DateTime;

    use super::*;
    use crate::test_utils::string_of_length;

    /// A comment on the same song as every other one here, with `parent` set
    /// when it is a reply.
    fn model(id: i64, parent: Option<i64>) -> comment::Model {
        comment::Model {
            id,
            created_at: DateTime::default(),
            parent,
            content: format!("comment {id}"),
            song_id: Some("song".to_owned()),
            user_id: Uuid::nil(),
        }
    }

    /// The ids in each thread, as (top level comment, [replies]).
    fn thread_ids(threads: &[(comment::Model, Vec<comment::Model>)]) -> Vec<(i64, Vec<i64>)> {
        threads
            .iter()
            .map(|(top_level, replies)| {
                (top_level.id, replies.iter().map(|reply| reply.id).collect())
            })
            .collect()
    }

    #[test]
    fn into_threads_puts_newest_comments_first_and_their_replies_oldest_first() {
        let threads = into_threads(vec![
            model(1, None),
            model(2, Some(1)),
            model(3, None),
            model(4, Some(1)),
            model(5, Some(3)),
        ]);

        assert_eq!(thread_ids(&threads), vec![(3, vec![5]), (1, vec![2, 4])]);
    }

    #[test]
    fn into_threads_drops_replies_without_a_top_level_parent() {
        let threads = into_threads(vec![
            model(1, None),
            model(2, Some(1)),
            // a reply to a reply
            model(3, Some(2)),
            // a reply to a comment that isn't in the list
            model(4, Some(99)),
        ]);

        assert_eq!(thread_ids(&threads), vec![(1, vec![2])]);
    }

    #[test]
    fn check_content_trims_and_limits_length_in_characters() {
        assert_eq!(
            check_content("  the bridge at 2:10 \n").unwrap(),
            "the bridge at 2:10"
        );

        // whitespace only is empty once trimmed
        assert!(check_content(" \n\t ").is_err());

        // the limit counts characters, not bytes, and not the trimmed whitespace
        let longest = "\u{e9}".repeat(MAX_COMMENT_CHARS);
        assert!(check_content(&format!("  {longest}  ")).is_ok());
        assert!(check_content(&string_of_length(MAX_COMMENT_CHARS + 1)).is_err());
    }
}
