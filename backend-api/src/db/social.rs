//! Social posts, likes, view status, interests, and the ranked feed's SQL.
//!
//! Ranking math that does not need the database lives here too. Turning text
//! into vectors is `services::social_feed`, which calls the python model.

use std::collections::HashMap;

use crate::db::entity::post_likes;
use crate::err::CadenzaError;
use chrono::{DateTime, TimeZone, Utc};
use sea_orm::prelude::Uuid;
use sea_orm::{
    ActiveValue::{NotSet, Set},
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait,
    FromQueryResult, QueryFilter, Statement, TransactionTrait, Value,
    sea_query::{ArrayType, OnConflict},
};

/// How many posts one `/feed` call returns. A shorter page means that exclude
/// mode is exhausted.
pub const FEED_SIZE: i64 = 10;

/// Prepended to the user vector so one day of age costs this much similarity
/// in the nearest-post lookup. Matches the python feed this replaced.
const AGE_MULTIPLIER: f64 = 0.02;

/// `posts.embedding_w_bday` stores days since this instant in its first component.
fn posts_epoch() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
}

/// Which `post_view_status` rows `/feed` leaves out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeedExclude {
    /// No view-status filter.
    None,
    /// Skip posts this user has already fully viewed.
    Viewed,
    /// Skip posts `/feed` has already returned to this user.
    Loaded,
}

/// One post, shaped for the feed and the profile page.
#[derive(Clone, Debug)]
pub struct SocialPost {
    pub post_id: i64,
    pub content: String,
    pub likes: i64,
    pub liked: bool,
    pub created_at: DateTime<Utc>,
    pub author_id: Uuid,
    pub author_username: String,
    /// Apple Music catalog id of the attached song or artist, when the author
    /// picked one. Kind is not stored; the client asks MusicKit.
    pub topic_mk_id: Option<String>,
}

/// Public header for someone else's profile page.
#[derive(Clone, Debug)]
pub struct PublicProfile {
    pub user_id: Uuid,
    pub username: String,
    pub bio: String,
}

/// One named interest a score update wants to move.
#[derive(Clone, Debug)]
pub struct InterestDelta {
    pub name: String,
    pub interest_type: String,
    pub delta: f64,
}

/// A candidate from the similar or hot query, before it is rescored.
#[derive(Clone, Debug)]
pub struct FeedCandidate {
    pub post_id: i64,
    pub embedding: Vec<f64>,
    pub likes: i64,
    pub created_at: DateTime<Utc>,
}

/// Inserts a post and returns its id. `embedding` is the model vector;
/// `embedding_w_bday` is that vector with days-since-epoch in front.
/// `topic_mk_id` is the Apple Music catalog id of an attached song or artist.
pub async fn insert_post(
    db: &DatabaseConnection,
    user_id: Uuid,
    content: &str,
    embedding: &[f64],
    embedding_w_bday: &[f64],
    topic_mk_id: Option<&str>,
) -> Result<i64, CadenzaError> {
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO posts (user_id, content, embedding, embedding_w_bday, topic_mk_id)
             VALUES ($1, $2, $3::vector, $4::vector, $5)
             RETURNING post_id",
            vec![
                user_id.into(),
                content.to_owned().into(),
                vector_literal(embedding).into(),
                vector_literal(embedding_w_bday).into(),
                topic_mk_id.map(str::to_owned).into(),
            ],
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("inserting a post returned no id".into()))?;
    Ok(row.try_get_by_index(0)?)
}

/// Records a like and bumps `likes` / `hot_score` only when the row is new.
pub async fn like_post(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    let inserted = post_likes::Entity::insert(post_likes::ActiveModel {
        post_id: Set(post_id),
        user_id: Set(user_id),
        date: NotSet,
    })
    .on_conflict(
        OnConflict::columns([post_likes::Column::PostId, post_likes::Column::UserId])
            .do_nothing()
            .to_owned(),
    )
    .exec_with_returning(&txn)
    .await;
    match inserted {
        Ok(_) => {}
        Err(DbErr::RecordNotInserted) => {
            txn.commit().await?;
            return Ok(());
        }
        Err(err) => return Err(err.into()),
    }
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE posts
         SET likes = likes + 1,
             hot_score = 10 * LOG(2, likes + 1) + (created_at::date - '1970-01-01'::date)
         WHERE post_id = $1",
        vec![post_id.into()],
    ))
    .await?;
    txn.commit().await?;
    Ok(())
}

/// Removes a like and drops `likes` / `hot_score` only when a row was deleted.
pub async fn unlike_post(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    let deleted = post_likes::Entity::delete_many()
        .filter(post_likes::Column::PostId.eq(post_id))
        .filter(post_likes::Column::UserId.eq(user_id))
        .exec_with_returning(&txn)
        .await?;
    if deleted.is_empty() {
        txn.commit().await?;
        return Ok(());
    }
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE posts
         SET likes = GREATEST(likes - 1, 0),
             hot_score = 10 * LOG(2, GREATEST(likes - 1, 1))
                 + (created_at::date - '1970-01-01'::date)
         WHERE post_id = $1",
        vec![post_id.into()],
    ))
    .await?;
    txn.commit().await?;
    Ok(())
}

/// Inserts `loaded` for ids that have no row yet. Never downgrades `viewed`.
pub async fn mark_posts_loaded(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_ids: &[i64],
) -> Result<(), CadenzaError> {
    if post_ids.is_empty() {
        return Ok(());
    }
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO post_view_status (post_id, user_id, status)
         SELECT post_id, $1, 'loaded'
         FROM unnest($2::bigint[]) AS post_id
         ON CONFLICT (post_id, user_id) DO NOTHING",
        vec![user_id.into(), bigint_array(post_ids)],
    ))
    .await?;
    Ok(())
}

/// Sets `viewed`, inserting or upgrading from `loaded`.
pub async fn mark_posts_viewed(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_ids: &[i64],
) -> Result<(), CadenzaError> {
    if post_ids.is_empty() {
        return Ok(());
    }
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO post_view_status (post_id, user_id, status)
         SELECT post_id, $1, 'viewed'
         FROM unnest($2::bigint[]) AS post_id
         ON CONFLICT (post_id, user_id) DO UPDATE
         SET status = 'viewed',
             date = now()",
        vec![user_id.into(), bigint_array(post_ids)],
    ))
    .await?;
    Ok(())
}

/// Display fields for `post_ids`, in that order. Missing ids are skipped.
pub async fn get_posts(
    db: &DatabaseConnection,
    viewer_id: Uuid,
    post_ids: &[i64],
) -> Result<Vec<SocialPost>, CadenzaError> {
    if post_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = PostRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT
             p.post_id,
             p.user_id AS author_id,
             p.content,
             p.likes,
             p.created_at,
             p.topic_mk_id,
             COALESCE(pr.username, 'unknown') AS username,
             EXISTS (
                 SELECT 1 FROM post_likes
                 WHERE post_likes.post_id = p.post_id
                   AND post_likes.user_id = $1
             ) AS liked
         FROM posts p
         LEFT JOIN profile pr ON pr.uid = p.user_id
         WHERE p.post_id = ANY($2::bigint[])",
        vec![viewer_id.into(), bigint_array(post_ids)],
    ))
    .all(db)
    .await?;

    let by_id: HashMap<i64, PostRow> = rows.into_iter().map(|row| (row.post_id, row)).collect();
    let mut posts = Vec::new();
    for post_id in post_ids {
        if let Some(row) = by_id.get(post_id) {
            posts.push(row.to_post());
        }
    }
    Ok(posts)
}

/// The author's profile row, when they have one.
pub async fn find_public_profile(
    db: &DatabaseConnection,
    author_id: Uuid,
) -> Result<Option<PublicProfile>, CadenzaError> {
    let row = ProfileRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT uid, username, bio FROM profile WHERE uid = $1",
        vec![author_id.into()],
    ))
    .one(db)
    .await?;

    Ok(row.map(|row| PublicProfile {
        user_id: row.uid,
        username: row.username,
        bio: row.bio,
    }))
}

/// Posts whose topic is this Apple Music catalog id, most liked first.
/// Equal scores fall back to newest first, then post id.
pub async fn get_topic_posts(
    db: &DatabaseConnection,
    viewer_id: Uuid,
    topic_mk_id: &str,
) -> Result<Vec<SocialPost>, CadenzaError> {
    let rows = PostRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT
             p.post_id,
             p.user_id AS author_id,
             p.content,
             p.likes,
             p.created_at,
             p.topic_mk_id,
             COALESCE(pr.username, 'unknown') AS username,
             EXISTS (
                 SELECT 1 FROM post_likes
                 WHERE post_likes.post_id = p.post_id
                   AND post_likes.user_id = $1
             ) AS liked
         FROM posts p
         LEFT JOIN profile pr ON pr.uid = p.user_id
         WHERE p.topic_mk_id = $2
         ORDER BY p.likes DESC, p.created_at DESC, p.post_id DESC",
        vec![viewer_id.into(), topic_mk_id.into()],
    ))
    .all(db)
    .await?;
    Ok(rows.iter().map(PostRow::to_post).collect())
}

/// One author's posts, newest first.
pub async fn get_author_posts(
    db: &DatabaseConnection,
    viewer_id: Uuid,
    author_id: Uuid,
) -> Result<Vec<SocialPost>, CadenzaError> {
    let rows = PostRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT
             p.post_id,
             p.user_id AS author_id,
             p.content,
             p.likes,
             p.created_at,
             p.topic_mk_id,
             COALESCE(pr.username, 'unknown') AS username,
             EXISTS (
                 SELECT 1 FROM post_likes
                 WHERE post_likes.post_id = p.post_id
                   AND post_likes.user_id = $1
             ) AS liked
         FROM posts p
         LEFT JOIN profile pr ON pr.uid = p.user_id
         WHERE p.user_id = $2
         ORDER BY p.created_at DESC",
        vec![viewer_id.into(), author_id.into()],
    ))
    .all(db)
    .await?;
    Ok(rows.iter().map(PostRow::to_post).collect())
}

/// Normalized weighted sum of the top 10 genres and top 10 artists.
/// `Ok(None)` when the user has nothing to sum.
pub async fn user_vector(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<Option<Vec<f64>>, CadenzaError> {
    let rows = InterestRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "(
             SELECT i.embedding::text AS embedding, s.score
             FROM interests i
             JOIN interest_scores s ON s.interest_id = i.interest_id
             WHERE s.user_id = $1
               AND i.embedding IS NOT NULL
               AND i.interest_type = 'genre'
               AND s.score != 0
             ORDER BY s.score DESC
             LIMIT 10
         )
         UNION ALL
         (
             SELECT i.embedding::text AS embedding, s.score
             FROM interests i
             JOIN interest_scores s ON s.interest_id = i.interest_id
             WHERE s.user_id = $1
               AND i.embedding IS NOT NULL
               AND i.interest_type = 'artist'
               AND s.score != 0
             ORDER BY s.score DESC
             LIMIT 10
         )",
        vec![user_id.into()],
    ))
    .all(db)
    .await?;

    let mut interests = Vec::with_capacity(rows.len());
    for row in &rows {
        interests.push((parse_vector(&row.embedding)?, row.score));
    }
    Ok(combine_interest_vectors(&interests))
}

/// Posts nearest the age-adjusted user vector, after `exclude`.
pub async fn similar_and_recent_posts(
    db: &DatabaseConnection,
    user_id: Uuid,
    exclude: FeedExclude,
    user_vector: Option<&[f64]>,
) -> Result<Vec<FeedCandidate>, CadenzaError> {
    let Some(user_vector) = user_vector else {
        return Ok(Vec::new());
    };
    let mut aged = Vec::with_capacity(user_vector.len() + 1);
    aged.push(AGE_MULTIPLIER);
    aged.extend_from_slice(user_vector);
    candidate_posts(
        db,
        user_id,
        exclude,
        "ORDER BY embedding_w_bday <#> $VEC::vector",
        Some(vector_literal(&aged)),
    )
    .await
}

/// Globally hot posts, after `exclude`.
pub async fn hot_posts(
    db: &DatabaseConnection,
    user_id: Uuid,
    exclude: FeedExclude,
) -> Result<Vec<FeedCandidate>, CadenzaError> {
    candidate_posts(db, user_id, exclude, "ORDER BY hot_score DESC", None).await
}

/// Ensures each interest exists. Returns whether it already had an embedding.
pub async fn upsert_interests(
    db: &DatabaseConnection,
    deltas: &[InterestDelta],
) -> Result<Vec<UpsertedInterest>, CadenzaError> {
    if deltas.is_empty() {
        return Ok(Vec::new());
    }
    let names: Vec<String> = deltas.iter().map(|d| d.name.clone()).collect();
    let types: Vec<String> = deltas.iter().map(|d| d.interest_type.clone()).collect();
    Ok(
        UpsertedInterest::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO interests (name, interest_type)
         SELECT name, itype::interest
         FROM unnest($1::text[], $2::text[]) AS t(name, itype)
         ON CONFLICT (name, interest_type) DO UPDATE SET name = EXCLUDED.name
         RETURNING interest_id, name, interest_type::text AS interest_type,
                   (embedding IS NOT NULL) AS embedding_exists",
            vec![text_array(&names), text_array(&types)],
        ))
        .all(db)
        .await?,
    )
}

/// Writes model vectors onto interests that did not have one.
pub async fn set_interest_embeddings(
    db: &DatabaseConnection,
    interest_ids: &[i64],
    embeddings: &[Vec<f64>],
) -> Result<(), CadenzaError> {
    if interest_ids.len() != embeddings.len() {
        return Err(CadenzaError::SocialFeedErr(
            "interest embedding count did not match".into(),
        ));
    }
    if interest_ids.is_empty() {
        return Ok(());
    }
    let literals: Vec<String> = embeddings.iter().map(|v| vector_literal(v)).collect();
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE interests AS i
         SET embedding = v.embedding::vector
         FROM unnest($1::bigint[], $2::text[]) AS v(interest_id, embedding)
         WHERE i.interest_id = v.interest_id",
        vec![bigint_array(interest_ids), text_array(&literals)],
    ))
    .await?;
    Ok(())
}

/// Adds each delta onto the user's score for that interest. `NotFound` when
/// the user has no auth row for the score's foreign key to point at.
pub async fn add_interest_scores(
    db: &DatabaseConnection,
    user_id: Uuid,
    interest_ids: &[i64],
    deltas: &[f64],
) -> Result<(), CadenzaError> {
    if interest_ids.is_empty() {
        return Ok(());
    }
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO interest_scores (user_id, interest_id, score)
         SELECT $1, interest_id, delta
         FROM unnest($2::bigint[], $3::float8[]) AS t(interest_id, delta)
         ON CONFLICT (user_id, interest_id) DO UPDATE
         SET score = interest_scores.score + EXCLUDED.score",
        vec![
            user_id.into(),
            bigint_array(interest_ids),
            double_array(deltas),
        ],
    ))
    .await
    .map_err(|err| {
        if is_missing_user(&err) {
            CadenzaError::NotFound
        } else {
            CadenzaError::from(err)
        }
    })?;
    Ok(())
}

/// Multiplies every score by 0.6 unless the user decayed in the last 6 hours
/// or their top score is under 5. A no-op in those cases, so the client can
/// call it on every launch.
pub async fn decay_interests(db: &DatabaseConnection, user_id: Uuid) -> Result<(), CadenzaError> {
    let recent = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT decayed_at FROM interest_scores_metadata WHERE user_id = $1",
            vec![user_id.into()],
        ))
        .await?;
    if let Some(row) = recent {
        let decayed_at: DateTime<chrono::FixedOffset> = row.try_get_by_index(0)?;
        if Utc::now().signed_duration_since(decayed_at) <= chrono::Duration::hours(6) {
            return Ok(());
        }
    }

    let max_row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT MAX(score) AS max_score FROM interest_scores WHERE user_id = $1",
            vec![user_id.into()],
        ))
        .await?;
    let max_score: Option<f64> = max_row.and_then(|row| row.try_get_by_index(0).ok());
    if max_score.unwrap_or(0.0) < 5.0 {
        return Ok(());
    }

    let txn = db.begin().await?;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE interest_scores SET score = score * 0.6 WHERE user_id = $1",
        vec![user_id.into()],
    ))
    .await?;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO interest_scores_metadata (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET decayed_at = now()",
        vec![user_id.into()],
    ))
    .await?;
    txn.commit().await?;
    Ok(())
}

/// Days since [`posts_epoch`], the same whole-day count the stored vector uses.
pub fn days_since_posts_epoch(now: DateTime<Utc>) -> i64 {
    (now - posts_epoch()).num_days()
}

/// Whole days from `created_at` to `now`.
pub fn age_days(created_at: DateTime<Utc>, now: DateTime<Utc>) -> i64 {
    (now - created_at).num_days()
}

/// `3 log2(likes+1) - log2(age_days+1) + 100 * similarity`.
pub fn score_post(likes: i64, age_days: i64, similarity: f64) -> f64 {
    let likes_score = 3.0 * ((likes + 1) as f64).log2();
    let age_score = -((age_days + 1) as f64).log2();
    likes_score + age_score + 100.0 * similarity
}

/// Normalized weighted sum of interest vectors. `None` when there is nothing
/// to sum or the result has length zero.
fn combine_interest_vectors(interests: &[(Vec<f64>, f64)]) -> Option<Vec<f64>> {
    let mut total: Option<Vec<f64>> = None;
    for (embedding, score) in interests {
        if *score == 0.0 || embedding.is_empty() {
            continue;
        }
        match &mut total {
            None => total = Some(embedding.iter().map(|x| x * score).collect()),
            Some(acc) if acc.len() == embedding.len() => {
                for (slot, value) in acc.iter_mut().zip(embedding) {
                    *slot += value * score;
                }
            }
            Some(_) => {}
        }
    }
    let total = total?;
    let norm = total.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm == 0.0 {
        return None;
    }
    Some(total.into_iter().map(|x| x / norm).collect())
}

/// pgvector text form, `[1,2,3]`.
pub fn vector_literal(values: &[f64]) -> String {
    let mut out = String::from("[");
    for (i, value) in values.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&value.to_string());
    }
    out.push(']');
    out
}

/// Parses a pgvector or JSON-array vector. Rejects anything that is not a
/// flat list of numbers.
pub fn parse_vector(text: &str) -> Result<Vec<f64>, CadenzaError> {
    let text = text.trim();
    let inner = text
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .ok_or_else(|| CadenzaError::DatabaseError(format!("vector was not a list: {text}")))?;
    if inner.trim().is_empty() {
        return Ok(Vec::new());
    }
    inner
        .split(',')
        .map(|part| {
            part.trim().parse::<f64>().map_err(|_| {
                CadenzaError::DatabaseError(format!("vector component was not a number: {part}"))
            })
        })
        .collect()
}

async fn candidate_posts(
    db: &DatabaseConnection,
    user_id: Uuid,
    exclude: FeedExclude,
    order_sql: &str,
    vector: Option<String>,
) -> Result<Vec<FeedCandidate>, CadenzaError> {
    let (where_sql, mut values) = exclude_clause(exclude, user_id);
    let mut order_sql = order_sql.to_owned();
    if let Some(vector) = vector {
        let index = values.len() + 1;
        order_sql = order_sql.replace("$VEC", &format!("${index}"));
        values.push(vector.into());
    }
    let limit_index = values.len() + 1;
    values.push(FEED_SIZE.into());

    let sql = format!(
        "SELECT post_id, embedding::text AS embedding, likes, created_at
         FROM posts
         {where_sql}
         {order_sql}
         LIMIT ${limit_index}"
    );
    let rows = CandidateRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        values,
    ))
    .all(db)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(FeedCandidate {
                post_id: row.post_id,
                embedding: parse_vector(&row.embedding)?,
                likes: row.likes,
                created_at: row.created_at.with_timezone(&Utc),
            })
        })
        .collect()
}

fn exclude_clause(exclude: FeedExclude, user_id: Uuid) -> (&'static str, Vec<Value>) {
    match exclude {
        FeedExclude::None => ("", Vec::new()),
        FeedExclude::Viewed => (
            "WHERE NOT EXISTS (
                 SELECT 1 FROM post_view_status
                 WHERE post_view_status.post_id = posts.post_id
                   AND post_view_status.user_id = $1
                   AND post_view_status.status = 'viewed'
             )",
            vec![user_id.into()],
        ),
        FeedExclude::Loaded => (
            "WHERE NOT EXISTS (
                 SELECT 1 FROM post_view_status
                 WHERE post_view_status.post_id = posts.post_id
                   AND post_view_status.user_id = $1
             )",
            vec![user_id.into()],
        ),
    }
}

fn bigint_array(ids: &[i64]) -> Value {
    Value::Array(
        ArrayType::BigInt,
        Some(Box::new(
            ids.iter()
                .copied()
                .map(|id| Value::BigInt(Some(id)))
                .collect(),
        )),
    )
}

fn text_array(items: &[String]) -> Value {
    Value::Array(
        ArrayType::String,
        Some(Box::new(
            items
                .iter()
                .map(|item| Value::String(Some(item.clone())))
                .collect(),
        )),
    )
}

fn double_array(items: &[f64]) -> Value {
    Value::Array(
        ArrayType::Double,
        Some(Box::new(
            items
                .iter()
                .copied()
                .map(|n| Value::Double(Some(n)))
                .collect(),
        )),
    )
}

fn is_missing_user(err: &DbErr) -> bool {
    let text = err.to_string();
    text.contains("23503") && text.contains("interest_scores")
}

#[derive(Debug, FromQueryResult)]
struct PostRow {
    post_id: i64,
    author_id: Uuid,
    content: String,
    likes: i64,
    created_at: DateTime<chrono::FixedOffset>,
    username: String,
    liked: bool,
    topic_mk_id: Option<String>,
}

impl PostRow {
    fn to_post(&self) -> SocialPost {
        SocialPost {
            post_id: self.post_id,
            content: self.content.clone(),
            likes: self.likes,
            liked: self.liked,
            created_at: self.created_at.with_timezone(&Utc),
            author_id: self.author_id,
            author_username: self.username.clone(),
            topic_mk_id: self.topic_mk_id.clone(),
        }
    }
}

#[derive(Debug, FromQueryResult)]
struct ProfileRow {
    uid: Uuid,
    username: String,
    bio: String,
}

#[derive(Debug, FromQueryResult)]
struct InterestRow {
    embedding: String,
    score: f64,
}

#[derive(Debug, FromQueryResult)]
struct CandidateRow {
    post_id: i64,
    embedding: String,
    likes: i64,
    created_at: DateTime<chrono::FixedOffset>,
}

/// An interest row just inserted or already present.
#[derive(Debug, Clone, FromQueryResult)]
pub struct UpsertedInterest {
    pub interest_id: i64,
    pub name: String,
    pub interest_type: String,
    pub embedding_exists: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_vector_weights_and_normalizes() {
        let vector =
            combine_interest_vectors(&[(vec![1.0, 0.0], 1.0), (vec![0.0, 1.0], 1.0)]).unwrap();
        let norm = vector.iter().map(|x| x * x).sum::<f64>().sqrt();
        assert!((norm - 1.0).abs() < 1e-9);
        assert!((vector[0] - vector[1]).abs() < 1e-9);
    }

    #[test]
    fn user_vector_is_none_without_scores() {
        assert!(combine_interest_vectors(&[(vec![1.0, 0.0], 0.0)]).is_none());
        assert!(combine_interest_vectors(&[]).is_none());
    }

    #[test]
    fn score_prefers_a_closer_newer_post() {
        let fresh = score_post(0, 0, 1.0);
        let old = score_post(0, 10, 0.0);
        assert!(fresh > old);
    }

    #[test]
    fn vector_literal_round_trips() {
        let text = vector_literal(&[0.5, -1.0, 2.0]);
        assert_eq!(parse_vector(&text).unwrap(), vec![0.5, -1.0, 2.0]);
    }
}
