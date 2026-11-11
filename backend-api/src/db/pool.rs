//! The connection pool one backend process opens.
//!
//! Each process gets its own pool of at most `max_connections`. A request that
//! finds every connection busy waits in the pool's queue, first come first
//! served, for at most `queue_timeout`, then fails fast as a 503
//! (`CadenzaError::DatabaseBusy`) for the client to retry. A wait that long
//! means the backend is overloaded, and a longer queue only hides it.
//!
//! Once a query runs, postgres cancels a statement past `statement_timeout`, and
//! ends a transaction left idle past `idle_in_transaction_timeout`. Both free the
//! connection for the next request in line.
//!
//! `DATABASE_URL` is Supabase's session-mode pooler (5432), which pins one server
//! connection per client and refuses anything past its `pool_size` (15). It also
//! drops startup options, so the timeouts are `SET` on every new connection
//! instead. That only sticks because session mode keeps the connection's
//! session. The transaction-mode port (6543) would not keep it.

use std::{env, time::Duration};

use sea_orm::{
    DatabaseConnection, SqlxPostgresConnector,
    sqlx::{
        self, ConnectOptions,
        postgres::{PgConnectOptions, PgPoolOptions},
    },
};

const DEFAULT_MAX_CONNECTIONS: u32 = 5;
const DEFAULT_QUEUE_TIMEOUT_SECS: u64 = 10;
const DEFAULT_STATEMENT_TIMEOUT_SECS: u64 = 30;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolConfig {
    /// Connections this process may open. Three processes at 5 fit in 15.
    pub max_connections: u32,
    /// Longest a request waits for a free connection before a 503.
    pub queue_timeout: Duration,
    /// Longest one statement may run once it starts.
    pub statement_timeout: Duration,
    /// Longest a transaction may sit open between statements.
    pub idle_in_transaction_timeout: Duration,
}

impl PoolConfig {
    /// Reads `DB_MAX_CONNECTIONS`, `DB_QUEUE_TIMEOUT_SECS`, and
    /// `DB_STATEMENT_TIMEOUT_SECS`. Missing, blank, or zero values use the
    /// defaults: 5 connections, 10 s in the queue, 30 s per statement. The idle
    /// in transaction timeout matches the statement timeout.
    pub fn from_env() -> Self {
        let max_connections = env::var("DB_MAX_CONNECTIONS").ok();
        let queue_timeout = env::var("DB_QUEUE_TIMEOUT_SECS").ok();
        let statement_timeout = env::var("DB_STATEMENT_TIMEOUT_SECS").ok();
        Self::from_values(
            max_connections.as_deref(),
            queue_timeout.as_deref(),
            statement_timeout.as_deref(),
        )
    }

    /// [`PoolConfig::from_env`] with the values already read, so the defaults
    /// can be tested without writing to the process environment.
    fn from_values(
        max_connections: Option<&str>,
        queue_timeout_secs: Option<&str>,
        statement_timeout_secs: Option<&str>,
    ) -> Self {
        let max_connections = positive::<u32>(max_connections).unwrap_or(DEFAULT_MAX_CONNECTIONS);
        let queue_timeout =
            Duration::from_secs(positive(queue_timeout_secs).unwrap_or(DEFAULT_QUEUE_TIMEOUT_SECS));
        let statement_timeout = Duration::from_secs(
            positive(statement_timeout_secs).unwrap_or(DEFAULT_STATEMENT_TIMEOUT_SECS),
        );
        Self {
            max_connections,
            queue_timeout,
            statement_timeout,
            idle_in_transaction_timeout: statement_timeout,
        }
    }

    /// The `SET`s run on every new connection.
    fn session_sql(&self) -> String {
        format!(
            "SET statement_timeout = {}; SET idle_in_transaction_session_timeout = {};",
            self.statement_timeout.as_millis(),
            self.idle_in_transaction_timeout.as_millis(),
        )
    }
}

/// A value above zero, or `None`.
fn positive<T: std::str::FromStr + PartialOrd + Default>(value: Option<&str>) -> Option<T> {
    value
        .and_then(|value| value.trim().parse::<T>().ok())
        .filter(|value| *value > T::default())
}

/// Opens this process's pool. Connections open lazily, up to
/// `max_connections`, and close after a minute idle or half an hour old, so a
/// running backend does not hold connections it is not using. Nothing helps
/// a process killed before it disconnects; the pooler reaps those itself.
pub async fn connect(db_url: &str, config: &PoolConfig) -> Result<DatabaseConnection, sqlx::Error> {
    let connect_options = db_url
        .parse::<PgConnectOptions>()?
        .disable_statement_logging();
    let session_sql = config.session_sql();
    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .min_connections(0)
        .acquire_timeout(config.queue_timeout)
        .idle_timeout(Duration::from_secs(60))
        .max_lifetime(Duration::from_secs(30 * 60))
        .after_connect(move |conn, _| {
            let sql = session_sql.clone();
            Box::pin(async move {
                sqlx::raw_sql(sqlx::AssertSqlSafe(sql))
                    .execute(conn)
                    .await
                    .map(|_| ())
            })
        })
        .connect_with(connect_options)
        .await?;
    Ok(SqlxPostgresConnector::from_sqlx_postgres_pool(pool))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_values_use_the_defaults() {
        let config = PoolConfig::from_values(None, None, None);
        assert_eq!(config.max_connections, 5);
        assert_eq!(config.queue_timeout, Duration::from_secs(10));
        assert_eq!(config.statement_timeout, Duration::from_secs(30));
        assert_eq!(config.idle_in_transaction_timeout, Duration::from_secs(30));
    }

    #[test]
    fn blank_zero_and_junk_use_the_defaults() {
        assert_eq!(
            PoolConfig::from_values(Some(" "), Some("0"), Some("soon")),
            PoolConfig::from_values(None, None, None),
        );
    }

    #[test]
    fn set_values_are_read() {
        let config = PoolConfig::from_values(Some(" 3 "), Some("10"), Some("5"));
        assert_eq!(config.max_connections, 3);
        assert_eq!(config.queue_timeout, Duration::from_secs(10));
        assert_eq!(config.statement_timeout, Duration::from_secs(5));
    }

    #[test]
    fn session_sql_sets_both_timeouts_in_milliseconds() {
        let config = PoolConfig::from_values(None, None, Some("2"));
        assert_eq!(
            config.session_sql(),
            "SET statement_timeout = 2000; SET idle_in_transaction_session_timeout = 2000;"
        );
    }

    /// One connection, so the second query has to wait in the queue.
    async fn live_pool(
        statement_timeout_secs: &str,
        queue_timeout_secs: &str,
    ) -> DatabaseConnection {
        dotenvy::dotenv().ok();
        let url = env::var("DATABASE_URL").expect("DATABASE_URL");
        let config = PoolConfig::from_values(
            Some("1"),
            Some(queue_timeout_secs),
            Some(statement_timeout_secs),
        );
        connect(&url, &config).await.expect("connect")
    }

    async fn sleep(db: &DatabaseConnection, secs: f64) -> Result<(), sea_orm::DbErr> {
        use sea_orm::ConnectionTrait;
        db.execute_unprepared(&format!("SELECT pg_sleep({secs})"))
            .await
            .map(|_| ())
    }

    /// The pooler drops startup options, so this checks the SET reached the session.
    #[tokio::test]
    #[ignore]
    async fn the_timeouts_reach_the_session() {
        use sea_orm::{ConnectionTrait, DbBackend, Statement};
        let db = live_pool("7", "10").await;
        let row = db
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "SELECT current_setting('statement_timeout'), current_setting('idle_in_transaction_session_timeout')",
            ))
            .await
            .expect("query")
            .expect("row");
        let statement: String = row.try_get_by_index(0).expect("statement_timeout");
        let idle: String = row.try_get_by_index(1).expect("idle timeout");
        assert_eq!((statement.as_str(), idle.as_str()), ("7s", "7s"));
    }

    #[tokio::test]
    #[ignore]
    async fn a_slow_statement_is_cancelled() {
        let db = live_pool("1", "10").await;
        let err = sleep(&db, 3.0)
            .await
            .expect_err("past the statement timeout");
        assert!(err.to_string().contains("statement timeout"), "{err}");
    }

    /// With every connection busy, the second query waits its turn and runs
    /// once the first frees the connection, instead of failing.
    #[tokio::test]
    #[ignore]
    async fn a_queued_query_runs_once_a_connection_frees() {
        let db = live_pool("30", "5").await;
        let start = std::time::Instant::now();
        let (first, second) = tokio::join!(sleep(&db, 3.0), sleep(&db, 0.0));
        first.expect("first");
        second.expect("second waited behind the first");
        assert!(start.elapsed() >= Duration::from_secs(3));
    }
}
