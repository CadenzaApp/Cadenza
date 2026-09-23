use std::collections::{BTreeMap, HashMap};

use sea_orm::{
    ActiveValue::Set,
    ConnectionTrait, EntityTrait, InsertMany,
    prelude::Uuid,
    sea_query::{Alias, Expr, ExprTrait, OnConflict},
};

use crate::db::entity::tag_scores;
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
}
