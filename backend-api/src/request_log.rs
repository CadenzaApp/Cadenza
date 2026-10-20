//! One log line per request, so a failing screen on the phone can be traced to
//! the endpoint, the status, and why.
//!
//! ```text
//! [api] 13:20:01.123 GET  /tags                      200    12ms
//! [api] 13:20:02.456 POST /queries/results           500 10004ms DatabaseError: pool timed out
//! [api] 13:20:03.001 GET  /analytics/summary         401     1ms unauthorized
//! ```
//!
//! The reason on a failed line comes from [`LoggedError`], which
//! `CadenzaError::into_response` attaches to the response it builds. A 401 from
//! the JWT extractor never goes through `CadenzaError`, so it is named by status.

use std::time::Instant;

use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use chrono::Local;
use sea_orm::DatabaseConnection;

/// The error a handler failed with, carried on its response for this log.
#[derive(Clone, Debug)]
pub struct LoggedError(pub String);

/// Logs the request once the response is ready. Successes go to stdout,
/// failures to stderr, both into the same dev log.
pub async fn log_request(
    State(db): State<DatabaseConnection>,
    request: Request,
    next: Next,
) -> Response {
    let pool = db.get_postgres_connection_pool();
    let pool_size_before = pool.size();
    let pool_idle_before = pool.num_idle();
    let method = request.method().clone();
    // the path only: query strings carry windows and ids, not why it failed,
    // and would push the status off the end of the line
    let path = request.uri().path().to_owned();
    let started = Instant::now();

    let response = next.run(request).await;

    let status = response.status();
    let elapsed_ms = started.elapsed().as_millis();
    let reason = response
        .extensions()
        .get::<LoggedError>()
        .map(|error| error.0.clone())
        .or_else(|| match status.as_u16() {
            401 => Some("unauthorized".to_owned()),
            404 => Some("no such route".to_owned()),
            _ => None,
        })
        .unwrap_or_default();

    let line = format!(
        "[api] {} {:<6} {:<34} {} {:>5}ms {}",
        Local::now().format("%H:%M:%S%.3f"),
        method.as_str(),
        path,
        status.as_u16(),
        elapsed_ms,
        reason
    );
    let line = line.trim_end();

    if status.is_server_error() && reason.starts_with("DatabaseError:") {
        eprintln!(
            "[db] pid={} path={} pool_max={} before(size={},idle={}) after(size={},idle={}) remote_session_limit={}",
            std::process::id(),
            path,
            pool.options().get_max_connections(),
            pool_size_before,
            pool_idle_before,
            pool.size(),
            pool.num_idle(),
            reason.contains("EMAXCONNSESSION")
        );
    }

    if status.is_client_error() || status.is_server_error() {
        eprintln!("{line}");
    } else {
        println!("{line}");
    }
    response
}
