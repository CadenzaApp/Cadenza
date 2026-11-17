pub mod activity_tags;
pub mod analytics;
pub mod audience;
pub mod collab;
pub mod entity;
pub mod events;
pub mod friend_relations;
pub mod invites;
pub mod listening_history;
pub mod live_sessions;
pub mod metadata_tags;
pub mod notification;
pub mod now_playing;
pub mod pool;
pub mod privacy;
pub mod profile;
pub mod queries;
pub mod saved_queries;
pub mod settings;
pub mod shared_playlists;
pub mod social;
#[cfg(test)]
mod social_listening_tests;
pub mod tag_activity;
pub mod tags;
pub mod user_data;
pub mod user_songs;

/// A postgres statement with its bound values, for SQL the entities cannot
/// express.
pub fn stmt(sql: &str, values: Vec<sea_orm::Value>) -> sea_orm::Statement {
    sea_orm::Statement::from_sql_and_values(sea_orm::DbBackend::Postgres, sql, values)
}

/// A connection or an open transaction. Functions that open their own
/// transaction take `&impl Db`, so a test can run them inside one that rolls
/// back.
pub trait Db:
    sea_orm::ConnectionTrait + sea_orm::TransactionTrait<Transaction = sea_orm::DatabaseTransaction>
{
}
impl<T> Db for T where
    T: sea_orm::ConnectionTrait
        + sea_orm::TransactionTrait<Transaction = sea_orm::DatabaseTransaction>
{
}
