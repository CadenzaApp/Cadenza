//! Storing the songs a saved query holds. A saved query is a list, not a live result: its
//! songs are what it matched when it was saved or last rerun. Tagging songs later only
//! changes it when the user turned on `auto_update_queries`, and then only by adding.

use std::collections::HashSet;

use sea_orm::{DatabaseConnection, prelude::Uuid};

use crate::db::entity::saved_queries;
use crate::db::queries::{Arrangement, QueryOptions, QuerySongs, query_reads_tags, run_query};
use crate::db::saved_queries::{
    SavedSong, append_saved_songs, get_saved_songs, get_viewable_saved_query, list_saved_queries,
    replace_saved_songs,
};
use crate::db::settings::get_settings;
use crate::err::CadenzaError;
use crate::routes::json::query::Query;

const LOG_TAG: &str = "[saved queries]";

/// Runs a saved query the way it was saved, with the user's Hide explicit content setting,
/// and returns every song it matches now, in order.
async fn run_saved(
    db: &DatabaseConnection,
    user_id: Uuid,
    saved: &saved_queries::Model,
) -> Result<Vec<SavedSong>, CadenzaError> {
    let query = serde_json::from_value::<Query>(saved.query.clone())
        .map_err(|err| CadenzaError::QueryFormatError(err.to_string()))?;
    let settings = get_settings(db, user_id).await?;
    let options = QueryOptions {
        consider_default_tags: saved.consider_default_tags,
        songs: if saved.library_or_tagged {
            QuerySongs::LibraryOrTagged
        } else {
            QuerySongs::Everything
        },
        hide_explicit: settings.hide_explicit,
    };
    let matches = run_query(db, &query, user_id, options, &Arrangement::default()).await?;
    Ok(matches
        .songs
        .into_iter()
        .map(|song| SavedSong {
            song_id: song.song_id,
            certain: song.certain,
        })
        .collect())
}

/// Reruns a saved query and replaces its songs with what it matches now.
pub async fn store_saved_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    saved: &saved_queries::Model,
) -> Result<Vec<SavedSong>, CadenzaError> {
    let songs = run_saved(db, user_id, saved).await?;
    replace_saved_songs(db, saved.saved_query_id, &songs).await?;
    Ok(songs)
}

/// The songs a saved query `viewer` may read holds, in order: their own, or one shared on
/// its owner's profile. A query saved before songs were stored gets them stored now, run as
/// its owner. `NotFound` when there is none by that id `viewer` may read.
pub async fn saved_songs(
    db: &DatabaseConnection,
    viewer: Uuid,
    saved_query_id: i64,
) -> Result<Vec<SavedSong>, CadenzaError> {
    let saved = get_viewable_saved_query(db, viewer, saved_query_id).await?;
    if saved.songs_stored_at.is_none() {
        return store_saved_songs(db, saved.user_id, &saved).await;
    }
    get_saved_songs(db, saved_query_id).await
}

/// Adds each of `song_ids` to every saved query it now matches, after `tag_ids` changed on
/// them. Does nothing unless the user turned on `auto_update_queries`. Only queries the
/// change can affect are run (`query_reads_tags`), and only by adding: a song that stopped
/// matching stays until the query is rerun.
pub async fn add_retagged_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
    tag_ids: &[i64],
) -> Result<(), CadenzaError> {
    if song_ids.is_empty() || !get_settings(db, user_id).await?.auto_update_queries {
        return Ok(());
    }
    let changed_tags: HashSet<i64> = tag_ids.iter().copied().collect();
    let changed_songs: HashSet<&str> = song_ids.iter().map(String::as_str).collect();

    for saved in list_saved_queries(db, user_id).await? {
        // one that has never stored songs gets all of them the first time it is read
        if saved.songs_stored_at.is_none() {
            continue;
        }
        let Ok(query) = serde_json::from_value::<Query>(saved.query.clone()) else {
            continue;
        };
        if !query_reads_tags(&query, &changed_tags) {
            continue;
        }
        let held: HashSet<String> = get_saved_songs(db, saved.saved_query_id)
            .await?
            .into_iter()
            .map(|song| song.song_id)
            .collect();
        let added: Vec<SavedSong> = run_saved(db, user_id, &saved)
            .await?
            .into_iter()
            .filter(|song| {
                changed_songs.contains(song.song_id.as_str()) && !held.contains(&song.song_id)
            })
            .collect();
        append_saved_songs(db, saved.saved_query_id, &added).await?;
    }
    Ok(())
}

/// [`add_retagged_songs`] on its own task, so a tag write never waits on it.
pub fn spawn_add_retagged_songs(
    db: DatabaseConnection,
    user_id: Uuid,
    song_ids: Vec<String>,
    tag_ids: Vec<i64>,
) {
    tokio::spawn(async move {
        if let Err(err) = add_retagged_songs(&db, user_id, &song_ids, &tag_ids).await {
            eprintln!("{LOG_TAG} could not update saved queries after tagging: {err}");
        }
    });
}
