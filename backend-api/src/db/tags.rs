use std::collections::{HashMap, HashSet};

use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, FromQueryResult,
    JoinType, ModelTrait, QueryFilter, QueryOrder, QuerySelect, Statement, TransactionTrait,
    prelude::Uuid,
    sea_query::OnConflict,
};
use serde::Serialize;

use crate::db::entity::*;
use crate::db::tag_votes::{TagVote, TagVoteCache, record_tag_vote};
use crate::err::CadenzaError;
use crate::services::tag_generation::TagSpecs;

pub async fn get_all_user_tags(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<Vec<tags::Model>, CadenzaError> {
    Ok(tags::Entity::find()
        .filter(tags::Column::UserId.eq(user_id))
        .all(db)
        .await?)
}

pub async fn get_tag(
    db: &DatabaseConnection,
    tag_id: i64,
) -> Result<Option<tags::Model>, CadenzaError> {
    Ok(tags::Entity::find_by_id(tag_id).one(db).await?)
}

#[derive(FromQueryResult)]
struct TagCount {
    tag_id: i64,
    count: Option<i64>,
}

#[derive(Serialize)]
pub struct TagMetadata {
    count: usize,
}

pub async fn get_user_tags_metadata(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<HashMap<i64, TagMetadata>, CadenzaError> {
    let tag_usage_counts = tags::Entity::find()
        .join_rev(
            JoinType::LeftJoin,
            user_tags_applied::Entity::belongs_to(tags::Entity)
                .from(user_tags_applied::Column::TagId)
                .to(tags::Column::TagId)
                .into(),
        )
        .select_only()
        .column(tags::Column::TagId)
        .column_as(user_tags_applied::Column::SongId.count(), "count")
        .filter(tags::Column::UserId.eq(user_id))
        .group_by(tags::Column::TagId)
        .into_model::<TagCount>()
        .all(db)
        .await?;

    let mut res = HashMap::new();
    for TagCount { tag_id, count } in tag_usage_counts {
        res.insert(
            tag_id,
            TagMetadata {
                count: count.unwrap_or(0) as usize,
            },
        );
    }

    Ok(res)
}

/// Returns the user's tags on each requested song. Songs new to the user are
/// initialized first (see [`init_user_songs`]), which is when they get copies of
/// their default tags. Every requested song gets an entry, so a song with no
/// tags comes back as an empty list.
pub async fn get_user_tags_on_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    // start every requested song off with no tags
    let mut songs_to_tags: HashMap<String, Vec<tags::Model>> = song_ids
        .iter()
        .map(|song_id| (song_id.clone(), Vec::new()))
        .collect();

    // no songs requested, so nothing to look up
    if songs_to_tags.is_empty() {
        return Ok(songs_to_tags);
    }

    // copy default tags onto songs new to the user, so the read below includes them
    init_user_songs(db, user_id, song_ids).await?;

    // fill in the user's tags on each song
    let applied = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .filter(user_tags_applied::Column::SongId.is_in(song_ids.iter().map(String::as_str)))
        .find_also_related(tags::Entity)
        .all(db)
        .await?;

    for (applied_tag, tag) in applied {
        let Some(tag) = tag else { continue };
        songs_to_tags
            .entry(applied_tag.song_id)
            .or_default()
            .push(tag);
    }

    Ok(songs_to_tags)
}

/// Initializes the requested songs that have no `song_meta` row for the user,
/// by adding one. A song is only ever initialized once, and that is the only
/// time it gets copies of its default tags, so removing its last tag later
/// leaves it empty. A song the user already has tags on keeps just those. A song
/// with no tags of either kind stays uninitialized, so default tags generated
/// for it later still get copied.
async fn init_user_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<(), CadenzaError> {
    // nothing to initialize, so skip the transaction and the lock
    if find_songs_to_init(db, user_id, song_ids).await?.song_ids.is_empty() {
        return Ok(());
    }

    let txn = db.begin().await?;

    // hold a per-user lock until commit, so two racing reads can't both
    // initialize the same song or create the same tag for this user
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT pg_advisory_xact_lock(hashtext('init_user_songs'), hashtext($1))",
        [user_id.to_string().into()],
    ))
    .await?;

    // look again under the lock, in case a racing read initialized some first
    let to_init = find_songs_to_init(&txn, user_id, song_ids).await?;

    // copy the default tags, then mark the songs initialized
    copy_default_tags_to_user(&txn, user_id, &to_init.default_tags).await?;
    insert_song_meta(&txn, user_id, to_init.song_ids).await?;

    txn.commit().await?;

    Ok(())
}

/// What [`init_user_songs`] does to a set of requested songs.
#[derive(Default)]
struct SongsToInit {
    /// The songs to add a `song_meta` row for.
    song_ids: Vec<String>,
    /// The default tags to copy to the user, keyed by song id.
    default_tags: HashMap<String, Vec<tags::Model>>,
}

/// Returns which of the requested songs to initialize, out of the ones with no
/// `song_meta` row for the user. A song the user already has tags on is
/// initialized without its default tags. A song with default tags is initialized
/// with them. A song with no tags of either kind is left out, so a read made
/// before its default tags are generated doesn't initialize it.
async fn find_songs_to_init(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<SongsToInit, CadenzaError> {
    // the songs already initialized for the user
    let initialized: HashSet<String> = song_meta::Entity::find()
        .filter(song_meta::Column::UserId.eq(user_id))
        .filter(song_meta::Column::SongId.is_in(song_ids.iter().map(String::as_str)))
        .select_only()
        .column(song_meta::Column::SongId)
        .into_tuple::<String>()
        .all(db)
        .await?
        .into_iter()
        .collect();

    // the requested songs not initialized yet
    let uninitialized: Vec<String> = song_ids
        .iter()
        .filter(|song_id| !initialized.contains(*song_id))
        .cloned()
        .collect();

    // every song is initialized already, so skip the tag lookups
    if uninitialized.is_empty() {
        return Ok(SongsToInit::default());
    }

    // the uninitialized songs the user already has tags on
    let user_tagged: HashSet<String> = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .filter(user_tags_applied::Column::SongId.is_in(uninitialized.iter().map(String::as_str)))
        .select_only()
        .column(user_tags_applied::Column::SongId)
        .distinct()
        .into_tuple::<String>()
        .all(db)
        .await?
        .into_iter()
        .collect();

    // default tags on the rest, since a song the user has tags on keeps just those
    let without_user_tags: Vec<String> = uninitialized
        .iter()
        .filter(|song_id| !user_tagged.contains(*song_id))
        .cloned()
        .collect();
    let default_tags = get_default_tags_on_songs(db, &without_user_tags).await?;

    // initialize the songs with tags of either kind. a song with neither waits,
    // so the default tags generated for it after this read still get copied
    let song_ids = uninitialized
        .into_iter()
        .filter(|song_id| user_tagged.contains(song_id) || default_tags.contains_key(song_id))
        .collect();

    Ok(SongsToInit {
        song_ids,
        default_tags,
    })
}

/// Adds a `song_meta` row for the user on each given song, marking it
/// initialized. Songs that already have one keep it.
async fn insert_song_meta(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    song_ids: impl IntoIterator<Item = String>,
) -> Result<(), CadenzaError> {
    let rows = song_ids.into_iter().map(|song_id| song_meta::ActiveModel {
        song_id: Set(song_id),
        user_id: Set(user_id),
        times_listened: NotSet,
    });

    song_meta::Entity::insert_many(rows)
        .on_conflict(
            OnConflict::columns([song_meta::Column::SongId, song_meta::Column::UserId])
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(db)
        .await?;

    Ok(())
}

/// Copies default tags into the user's own tags and applies the copies to the
/// songs. A default tag reuses the user's tag with the same name when they have
/// one, and otherwise becomes a new tag of theirs with the default's name,
/// color, and type. Run it inside the lock [`init_user_songs`] takes, so racing
/// reads can't create the same tag twice.
async fn copy_default_tags_to_user(
    txn: &impl ConnectionTrait,
    user_id: Uuid,
    default_tags: &HashMap<String, Vec<tags::Model>>,
) -> Result<(), CadenzaError> {
    // no default tags, so nothing to copy
    if default_tags.is_empty() {
        return Ok(());
    }

    // find the user's tags that already have a default tag's name
    let default_names: HashSet<&str> = default_tags
        .values()
        .flatten()
        .map(|tag| tag.name.as_str())
        .collect();

    let mut name_to_user_tag: HashMap<String, tags::Model> = tags::Entity::find()
        .filter(tags::Column::UserId.eq(user_id))
        .filter(tags::Column::Name.is_in(default_names.iter().copied()))
        .all(txn)
        .await?
        .into_iter()
        .map(|tag| (tag.name.clone(), tag))
        .collect();

    // create a tag for the user for each default name they don't have yet, once per name
    let new_tags: HashMap<&str, tags::ActiveModel> = default_tags
        .values()
        .flatten()
        .filter(|tag| !name_to_user_tag.contains_key(&tag.name))
        .map(|tag| {
            let new_tag = tags::ActiveModel {
                tag_id: NotSet,
                user_id: Set(Some(user_id)),
                name: Set(tag.name.clone()),
                color: Set(tag.color.clone()),
                r#type: Set(tag.r#type.clone()),
            };
            (tag.name.as_str(), new_tag)
        })
        .collect();

    let created = tags::Entity::insert_many(new_tags.into_values())
        .exec_with_returning(txn)
        .await?;
    name_to_user_tag.extend(created.into_iter().map(|tag| (tag.name.clone(), tag)));

    // put the user's copies on the songs in place of the default tags. rows that
    // already exist are skipped
    let applied = default_tags.iter().flat_map(|(song_id, defaults)| {
        defaults
            .iter()
            .filter_map(|tag| name_to_user_tag.get(&tag.name))
            .map(|copy| user_tags_applied::ActiveModel {
                song_id: Set(song_id.clone()),
                user_id: Set(user_id),
                tag_id: Set(copy.tag_id),
                value: NotSet,
            })
    });

    user_tags_applied::Entity::insert_many(applied)
        .on_conflict(
            OnConflict::columns([
                user_tags_applied::Column::SongId,
                user_tags_applied::Column::UserId,
                user_tags_applied::Column::TagId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(txn)
        .await?;

    Ok(())
}

/// Returns the requested songs that have no tags at all, meaning none of the
/// user's tags and no default tags. Keeps the order the ids were given in.
pub async fn get_untagged_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<Vec<String>, CadenzaError> {
    // tags on each song, after copying default tags onto songs new to the user
    let tags_by_song = get_user_tags_on_songs(db, user_id, song_ids).await?;

    // the songs that came back with none
    let songs_without_tags: Vec<String> = song_ids
        .iter()
        .filter(|song_id| tags_by_song.get(*song_id).is_none_or(Vec::is_empty))
        .cloned()
        .collect();

    // an initialized song can still have default tags the user no longer sees,
    // like after removing all of its tags. those are not untagged, so leave them out
    let default_tags = get_default_tags_on_songs(db, &songs_without_tags).await?;

    Ok(songs_without_tags
        .into_iter()
        .filter(|song_id| !default_tags.contains_key(song_id))
        .collect())
}

pub async fn get_songs_with_user_tag(
    db: &DatabaseConnection,
    user_id: Uuid,
    tag_id: i64,
) -> Result<Vec<String>, CadenzaError> {
    let song_ids: Vec<String> = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::TagId.eq(tag_id))
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .select_only()
        .column(user_tags_applied::Column::SongId)
        .into_tuple()
        .all(db)
        .await?;

    Ok(song_ids)
}

pub async fn new_user_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    name: String,
    color: String,
) -> Result<i64, CadenzaError> {
    let new_tag = tags::ActiveModel {
        tag_id: NotSet,
        user_id: Set(Some(user_id)),
        name: Set(name),
        color: Set(color),
        r#type: NotSet,
    };
    let new_tag = new_tag.insert(&db).await?;

    Ok(new_tag.tag_id)
}

pub async fn delete_user_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let tag = tags::Entity::find_by_id(tag_id)
        .filter(tags::Column::UserId.eq(user_id))
        .one(&db)
        .await?;

    if let Some(tag) = tag {
        tag.delete(&db).await?;
    }

    Ok(())
}

/// Puts one of the user's tags on a song, and initializes the song for the user
/// if it isn't yet. Otherwise removing this tag would leave the song
/// uninitialized, and the next read would copy its default tags onto it. Also
/// votes yes on the tag's name for the song, which can make the name a default
/// tag there (see [`record_tag_vote`]).
pub async fn apply_user_tag(
    db: DatabaseConnection,
    votes: &TagVoteCache,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;

    // put the tag on the song
    let new_tag_relation = user_tags_applied::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(song_id.clone()),
        tag_id: Set(tag_id),
        value: NotSet,
    };
    new_tag_relation.insert(&txn).await?;

    // the user put this tag on the song, so its name gets a yes vote
    let tag = tags::Entity::find_by_id(tag_id).one(&txn).await?;
    let recorded = match &tag {
        Some(tag) => {
            Some(record_tag_vote(&txn, votes, user_id, &song_id, tag, TagVote::Yes).await?)
        }
        None => None,
    };

    // the song has a tag of the user's now, so it counts as initialized
    insert_song_meta(&txn, user_id, [song_id]).await?;

    txn.commit().await?;

    // update the vote cache only once the vote is committed
    if let Some(recorded) = recorded {
        votes.remember(recorded);
    }
    Ok(())
}

/// Takes one of the user's tags off a song, and votes no on the tag's name for
/// the song (see [`record_tag_vote`]). No-ops if the tag isn't on the song.
pub async fn unapply_user_tag(
    db: DatabaseConnection,
    votes: &TagVoteCache,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;

    // the tag on the song, along with the tag itself for its name
    let applied = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::SongId.eq(song_id.as_str()))
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .filter(user_tags_applied::Column::TagId.eq(tag_id))
        .find_also_related(tags::Entity)
        .one(&txn)
        .await?;

    // the vote this request cast, if it is the one that removed the tag
    let mut recorded = None;
    if let Some((applied_tag, tag)) = applied {
        // a racing request may have removed it first, so only vote if this delete did
        let deleted = applied_tag.delete(&txn).await?;
        if let (1.., Some(tag)) = (deleted.rows_affected, tag) {
            recorded =
                Some(record_tag_vote(&txn, votes, user_id, &song_id, &tag, TagVote::No).await?);
        }
    }

    txn.commit().await?;

    // update the vote cache only once the vote is committed
    if let Some(recorded) = recorded {
        votes.remember(recorded);
    }
    Ok(())
}

/// Puts the default tag with the given name on the song, creating that default
/// tag with the given color if there isn't one. Only touches default tags, so
/// users who already initialized the song don't get it. Songs that already have
/// it are left alone.
pub async fn add_default_tag_to_song(
    db: &impl ConnectionTrait,
    song_id: &str,
    name: &str,
    color: &str,
) -> Result<(), CadenzaError> {
    // reuse the default tag with this name, the oldest if there are several
    let existing = tags::Entity::find()
        .filter(tags::Column::UserId.is_null())
        .filter(tags::Column::Name.eq(name))
        .order_by_asc(tags::Column::TagId)
        .one(db)
        .await?;

    // or create it
    let tag_id = match existing {
        Some(tag) => tag.tag_id,
        None => {
            let created = tags::ActiveModel {
                tag_id: NotSet,
                user_id: Set(None),
                name: Set(name.to_owned()),
                color: Set(color.to_owned()),
                r#type: NotSet,
            }
            .insert(db)
            .await?;
            created.tag_id
        }
    };

    default_tags_applied::Entity::insert(default_tags_applied::ActiveModel {
        song_id: Set(song_id.to_owned()),
        tag_id: Set(tag_id),
    })
    .on_conflict(
        OnConflict::columns([
            default_tags_applied::Column::SongId,
            default_tags_applied::Column::TagId,
        ])
        .do_nothing()
        .to_owned(),
    )
    .exec_without_returning(db)
    .await?;

    Ok(())
}


/// Returns the default tags on each given song, keyed by song id. Songs with no
/// default tags are left out.
pub async fn get_default_tags_on_songs(
    db: &impl ConnectionTrait,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    // no songs, so nothing to look up
    if song_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let applied = default_tags_applied::Entity::find()
        .filter(default_tags_applied::Column::SongId.is_in(song_ids))
        .find_also_related(tags::Entity)
        .all(db)
        .await?;

    let mut res: HashMap<String, Vec<tags::Model>> = HashMap::new();
    for (applied, tag) in applied {
        if let Some(tag) = tag {
            res.entry(applied.song_id).or_default().push(tag);
        }
    }

    Ok(res)
}

/// replaces the default tags on each given song with the given tags,
/// creating tags that don't exist yet. returns the applied tags per song id.
pub async fn set_default_tags_on_songs(
    db: &DatabaseConnection,
    song_to_tags: HashMap<String, Vec<TagSpecs>>,
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    let song_ids: Vec<&String> = song_to_tags.keys().collect();
    let new_tags: HashMap<&str, &TagSpecs> = song_to_tags
        .values()
        .flatten()
        .map(|tag| (tag.name.as_str(), tag))
        .collect();

    let mut name_to_tag: HashMap<&str, tags::Model> = tags::Entity::find()
        .filter(tags::Column::UserId.is_null())
        .filter(tags::Column::Name.is_in(new_tags.keys().copied()))
        .all(db)
        .await?
        .into_iter()
        .filter_map(|tag| Some((*new_tags.get_key_value(tag.name.as_str())?.0, tag)))
        .collect();

    for (name, new_tag) in new_tags {
        if name_to_tag.contains_key(name) {
            continue;
        }

        let created = tags::ActiveModel {
            tag_id: NotSet,
            user_id: Set(None),
            name: Set(new_tag.name.clone()),
            color: Set(new_tag.color.clone()),
            r#type: NotSet,
        }
        .insert(db)
        .await?;

        name_to_tag.insert(name, created);
    }

    default_tags_applied::Entity::delete_many()
        .filter(default_tags_applied::Column::SongId.is_in(song_ids))
        .exec(db)
        .await?;

    let res: HashMap<String, Vec<tags::Model>> = song_to_tags
        .iter()
        .map(|(song_id, tags)| {
            let tags = tags
                .iter()
                .filter_map(|tag| name_to_tag.get(tag.name.as_str()).cloned())
                .collect();
            (song_id.clone(), tags)
        })
        .collect();

    let new_relations = res.iter().flat_map(|(song_id, tags)| {
        tags.iter().map(|tag| default_tags_applied::ActiveModel {
            song_id: Set(song_id.clone()),
            tag_id: Set(tag.tag_id),
        })
    });

    default_tags_applied::Entity::insert_many(new_relations)
        .on_conflict(
            OnConflict::columns([
                default_tags_applied::Column::SongId,
                default_tags_applied::Column::TagId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(db)
        .await?;

    Ok(res)
}
