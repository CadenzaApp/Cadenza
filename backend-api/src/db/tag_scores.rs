use std::collections::{BTreeMap, HashMap};

use sea_orm::{
    ActiveValue::Set,
    ColumnTrait, ConnectionTrait, EntityTrait, InsertMany, QueryFilter, QueryOrder, QuerySelect,
    Select, UpdateMany,
    prelude::Uuid,
    sea_query::{Alias, Expr, ExprTrait, OnConflict, Query},
};

use crate::db::entity::{tag_scores, tag_scores_metadata};
use crate::err::CadenzaError;
use crate::services::tag_normalizer::normalize_tag_name;

/// The most tag names one score edit can name, same cap as the song batches.
const MAX_SCORED_TAG_NAMES: usize = 200;

/// Adds each delta to the user's score for that tag name, in one upsert. A name
/// the user has no row for starts at its delta, and a negative delta takes a
/// score down, below zero included.
///
/// Names go through [`normalize_tag_name`] first, so `"Pop"` and `" pop "` are
/// one score. Two names that normalize to the same one have their deltas added
/// together rather than one of them winning.
///
/// Returns the score every named tag is left at, keyed by the normalized name.
pub async fn add_to_tag_scores(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    deltas: HashMap<String, i64>,
) -> Result<BTreeMap<String, i64>, CadenzaError> {
    let scores = score_upsert(user_id, normalize_deltas(deltas)?)
        .exec_with_returning(db)
        .await?;

    Ok(scores
        .into_iter()
        .map(|row| (row.tag_name, row.score))
        .collect())
}

/// Normalizes the tag names a score edit asked for and adds up the deltas of any
/// that collapsed into one name.
///
/// A `BTreeMap`, so the upsert touches rows in name order however the request
/// listed them. Two requests naming the same tags then lock those rows in the
/// same order and cannot deadlock each other.
///
/// `QueryFormatError` if the request names more than [`MAX_SCORED_TAG_NAMES`]
/// tags, or a name that normalizes to nothing.
fn normalize_deltas(deltas: HashMap<String, i64>) -> Result<BTreeMap<String, i64>, CadenzaError> {
    if deltas.len() > MAX_SCORED_TAG_NAMES {
        return Err(CadenzaError::QueryFormatError(format!(
            "requests are limited to {MAX_SCORED_TAG_NAMES} tag names"
        )));
    }

    let mut normalized = BTreeMap::new();
    for (tag_name, delta) in deltas {
        let name = normalize_tag_name(&tag_name);
        if name.is_empty() {
            return Err(CadenzaError::QueryFormatError(format!(
                "{tag_name:?} is not a tag name"
            )));
        }

        // saturating, so two names that collapsed into one cannot overflow the
        // sum before it reaches the database
        let total = normalized.entry(name).or_insert(0i64);
        *total = total.saturating_add(delta);
    }

    Ok(normalized)
}

/// Every user with at least one score whose last decay week is before `week`,
/// or who has no decay week at all, in user id order.
///
/// Not user scoped: the weekly decay in `services::tag_score_decay` is the only
/// caller, and it walks every user this returns.
pub async fn get_users_due_for_decay(
    db: &impl ConnectionTrait,
    week: i32,
) -> Result<Vec<Uuid>, CadenzaError> {
    Ok(users_due_for_decay_select(week)
        .into_tuple::<Uuid>()
        .all(db)
        .await?)
}

/// Returns the select behind [`get_users_due_for_decay`].
fn users_due_for_decay_select(week: i32) -> Select<tag_scores::Entity> {
    let decayed_this_week = Query::select()
        .column(tag_scores_metadata::Column::UserId)
        .from(tag_scores_metadata::Entity)
        .and_where(tag_scores_metadata::Column::LastDecayWeek.gte(week))
        .to_owned();

    tag_scores::Entity::find()
        .select_only()
        .column(tag_scores::Column::UserId)
        .distinct()
        .filter(tag_scores::Column::UserId.not_in_subquery(decayed_this_week))
        .order_by_asc(tag_scores::Column::UserId)
}

/// The user's highest score, or `None` when they have none.
pub async fn get_max_score(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<Option<i64>, CadenzaError> {
    let max = tag_scores::Entity::find()
        .select_only()
        .column_as(tag_scores::Column::Score.max(), "max_score")
        .filter(tag_scores::Column::UserId.eq(user_id))
        .into_tuple::<Option<i64>>()
        .one(db)
        .await?;

    Ok(max.flatten())
}

/// Halves every one of the user's tag scores and returns how many rows it
/// moved.
pub async fn halve_user_tag_scores(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<u64, CadenzaError> {
    let halved = halve_user_scores_update(user_id).exec(db).await?;
    Ok(halved.rows_affected)
}

/// Returns the update that halves the user's scores in place.
///
/// Postgres truncates integer division toward zero, so a score of 1 lands on 0
/// and so does -1. Rows are never deleted, so a name that decayed to 0 keeps its
/// row and can climb back out of it.
fn halve_user_scores_update(user_id: Uuid) -> UpdateMany<tag_scores::Entity> {
    tag_scores::Entity::update_many()
        .col_expr(
            tag_scores::Column::Score,
            Expr::col(tag_scores::Column::Score).div(2),
        )
        .filter(tag_scores::Column::UserId.eq(user_id))
}

/// Returns the upsert that adds each delta to that tag name's score for the
/// user, inserting the row at the delta when there is none.
fn score_upsert(
    user_id: Uuid,
    deltas: BTreeMap<String, i64>,
) -> InsertMany<tag_scores::ActiveModel> {
    let rows = deltas
        .into_iter()
        .map(|(tag_name, delta)| tag_scores::ActiveModel {
            tag_name: Set(tag_name),
            user_id: Set(user_id),
            score: Set(delta),
        });

    // qualified, since postgres finds a bare column name ambiguous in DO UPDATE
    let stored = Expr::col((tag_scores::Entity, tag_scores::Column::Score));
    // the delta the statement tried to insert for the row it conflicted with
    let delta = Expr::col((Alias::new("excluded"), tag_scores::Column::Score));

    let mut on_conflict =
        OnConflict::columns([tag_scores::Column::TagName, tag_scores::Column::UserId]);
    on_conflict.value(tag_scores::Column::Score, stored.add(delta));

    tag_scores::Entity::insert_many(rows).on_conflict(on_conflict)
}

#[cfg(test)]
mod tests {
    use sea_orm::{DbBackend, QueryTrait};

    use super::*;
    use crate::test_utils::string_of_length;

    /// The deltas a request body of `pairs` asks for.
    fn deltas<const N: usize>(pairs: [(&str, i64); N]) -> HashMap<String, i64> {
        pairs
            .into_iter()
            .map(|(name, delta)| (name.to_owned(), delta))
            .collect()
    }

    #[test]
    fn normalize_deltas_lowercases_and_collapses_whitespace_in_names() {
        assert_eq!(
            normalize_deltas(deltas([("  Alt   Rock  ", 5)])).unwrap(),
            BTreeMap::from([("alt rock".to_owned(), 5)])
        );
    }

    #[test]
    fn normalize_deltas_adds_up_names_that_collapse_into_one() {
        // "Pop" and " pop " are the same score, so the request moves it by 4
        assert_eq!(
            normalize_deltas(deltas([("Pop", 5), (" pop ", -1)])).unwrap(),
            BTreeMap::from([("pop".to_owned(), 4)])
        );
    }

    #[test]
    fn normalize_deltas_keeps_a_delta_of_zero() {
        // the row still gets written, at whatever it was already
        assert_eq!(
            normalize_deltas(deltas([("pop", 0)])).unwrap(),
            BTreeMap::from([("pop".to_owned(), 0)])
        );
    }

    #[test]
    fn normalize_deltas_rejects_a_name_that_normalizes_to_nothing() {
        assert!(normalize_deltas(deltas([("   ", 5)])).is_err());
        assert!(normalize_deltas(deltas([("", 5)])).is_err());
    }

    #[test]
    fn normalize_deltas_rejects_more_names_than_the_cap() {
        let too_many = (0..=MAX_SCORED_TAG_NAMES)
            .map(|index| (index.to_string(), 1))
            .collect();

        assert!(normalize_deltas(too_many).is_err());
    }

    #[test]
    fn normalize_deltas_truncates_a_long_name_to_the_tag_name_limit() {
        let long_name = string_of_length(200);
        let normalized = normalize_deltas(deltas([(long_name.as_str(), 1)])).unwrap();

        assert_eq!(normalized.keys().next().unwrap().len(), 50);
    }

    #[test]
    fn score_upsert_adds_each_delta_to_the_score_already_there() {
        let user_id = Uuid::nil();
        let sql = score_upsert(user_id, BTreeMap::from([("pop".to_owned(), 5)]))
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"INSERT INTO "tag_scores" ("tag_name", "score", "user_id") VALUES ('pop', 5, '00000000-0000-0000-0000-000000000000') ON CONFLICT ("tag_name", "user_id") DO UPDATE SET "score" = "tag_scores"."score" + "excluded"."score""#
        );
    }

    #[test]
    fn score_upsert_writes_the_names_in_order_however_the_request_listed_them() {
        let user_id = Uuid::nil();
        let sql = score_upsert(
            user_id,
            normalize_deltas(deltas([("rock", 10), ("jazz", -2), ("pop", 5)])).unwrap(),
        )
        .build(DbBackend::Postgres)
        .to_string();

        assert!(
            sql.contains(
                r#"VALUES ('jazz', -2, '00000000-0000-0000-0000-000000000000'), ('pop', 5, '00000000-0000-0000-0000-000000000000'), ('rock', 10, '00000000-0000-0000-0000-000000000000')"#
            ),
            "{sql}"
        );
    }

    #[test]
    fn users_due_for_decay_select_leaves_out_users_already_decayed_this_week() {
        let sql = users_due_for_decay_select(10)
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"SELECT DISTINCT "tag_scores"."user_id" FROM "tag_scores" WHERE "tag_scores"."user_id" NOT IN (SELECT "user_id" FROM "tag_scores_metadata" WHERE "tag_scores_metadata"."last_decay_week" >= 10) ORDER BY "tag_scores"."user_id" ASC"#
        );
    }

    #[test]
    fn halve_user_scores_update_divides_only_that_users_scores() {
        let sql = halve_user_scores_update(Uuid::nil())
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"UPDATE "tag_scores" SET "score" = "score" / 2 WHERE "tag_scores"."user_id" = '00000000-0000-0000-0000-000000000000'"#
        );
    }
}
